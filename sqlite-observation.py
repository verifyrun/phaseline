"""Optional SQLite reader for the Phaseline CLI and library (Python 3.11+)."""
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import sys


# Only deterministic built-ins needed for relational reads. New functions require review.
FUNCTIONS = frozenset("abs avg coalesce count ifnull instr length like lower ltrim max min nullif replace round rtrim substr substring sum total trim typeof upper".split())


def observe(request):
    database, before, after, terms = (request[k] for k in ("database", "before", "after", "terms"))
    report = {"scope": "sqlite_read_transaction", "sqlite": sqlite3.sqlite_version,
              "editions": [], "spent": 0}
    paid = set()
    reads = set()
    problem = {}

    def hold(reason, **details):
        return {**report, "status": "hold", "reason": reason, **details}

    def deny(reason, **details):
        problem.update(reason=reason, **details)
        return sqlite3.SQLITE_DENY

    def authorize(op, table, column, schema, context):
        if op == sqlite3.SQLITE_SELECT:
            return sqlite3.SQLITE_OK
        if op == sqlite3.SQLITE_FUNCTION and column in FUNCTIONS:
            return sqlite3.SQLITE_OK
        if op != sqlite3.SQLITE_READ or schema not in ("main", None):
            return deny("unsupported_operation")
        grant = terms["grants"].get(table, {})
        if column not in grant:
            return deny("missing_grant", need={"table": table, "column": column})
        key = (table, column)
        reads.add(key)
        if key not in paid:
            price = grant[column]
            if report["spent"] + price > terms["budget"]:
                return deny("over_budget", need={"table": table, "column": column, "price": price})
            report["spent"] += price
            paid.add(key)
        return sqlite3.SQLITE_OK

    try:
        conn = sqlite3.connect(Path(database).resolve().as_uri() + "?mode=ro",
                               uri=True, timeout=1, cached_statements=0)
    except (ValueError, OSError, sqlite3.Error):
        return hold("source_unavailable")
    with closing(conn):
        # Both editions must see the same committed source state.
        conn.execute("PRAGMA query_only=ON")
        conn.execute("PRAGMA trusted_schema=OFF")
        conn.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 1_000_000)
        conn.execute("BEGIN")
        conn.set_authorizer(authorize)
        steps = 0

        def progress():
            nonlocal steps
            steps += 1000
            if steps >= 5_000_000:
                problem.update(reason="work_limit")
                return 1
            return 0

        conn.set_progress_handler(progress, 1000)
        results = []
        dependencies = []
        for i, edition in enumerate((before, after)):
            reads.clear()
            report["checking"] = ("before", "after")[i]
            try:
                sql = edition
                definition = edition
                if request["mode"] == "views":
                    metadata = conn.execute(
                        "select sql from main.sqlite_schema where type='view' and name=?", (edition,)).fetchone()
                    if metadata is None:
                        return hold("view_unavailable", need={"view": edition})
                    definition = metadata[0]
                    view = '"' + edition.replace('"', '""') + '"'
                    column = '"' + terms["recipient"].replace('"', '""') + '"'
                    sql = f"select {view}.{column} from main.{view}"
                digest = hashlib.sha256(definition.encode()).hexdigest()
                report["editions"].append(digest)
                if "editionDigests" in terms and terms["editionDigests"][i] != digest:
                    return hold("edition_mismatch")
                cursor = conn.execute(sql)
                columns = [c[0] for c in cursor.description or ()]
                if columns.count(terms["recipient"]) != 1:
                    return hold("recipient_column", need={"column": terms["recipient"]})
                index = columns.index(terms["recipient"])
                recipients = set()
                for n, row in enumerate(cursor, 1):
                    if n > 100_000:
                        return hold("work_limit")
                    value = row[index]
                    if not ((type(value) is str and 0 < len(value.encode()) <= 512)
                            or (type(value) is int and abs(value) <= 2**53-1)):
                        return hold("recipient_value")
                    recipients.add(value)
                    if len(recipients) > 2048:
                        return hold("recipient_limit")
            except sqlite3.Error as error:
                if problem:
                    return hold(**problem)
                return hold("query_error", detail=str(error))
            results.append(recipients)
            dependencies.append(reads.copy())

    def ordered(values):
        return sorted(values, key=lambda v: (type(v).__name__, v))

    old, new = results
    report.pop("checking")
    if "expectedAfter" in terms:
        expected = set(terms["expectedAfter"])
        if new != expected:
            return hold("recipient_mismatch", missing=ordered(expected - new), unexpected=ordered(new - expected))
    status = "matched" if "expectedAfter" in terms else "observed"
    return {**report, "status": status, "before": ordered(old), "after": ordered(new),
            "added": ordered(new - old), "removed": ordered(old - new),
            "reads": [sorted(fields) for fields in dependencies],
            "newReads": sorted(dependencies[1] - dependencies[0])}


if __name__ == "__main__":
    if sys.version_info < (3, 11):
        print(json.dumps({"status": "hold", "reason": "observer_unavailable"}))
    else:
        print(json.dumps(observe(json.load(sys.stdin)), ensure_ascii=False, separators=(",", ":")))
