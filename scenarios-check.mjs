// Ten everyday gates, each written the way a newcomer would write it, with cases and the answers expected.
// They double as examples: copy one and change the names. Times are minutes.
import assert from "node:assert/strict";
import {decide, compare} from "./index.mjs";

// Every record carries the event time of the case it belongs to (at) and when it was written (recorded).
// A record written before the event, or about another event, is not read.
const AT = 0, NOW = 600000;
// rec("billing.settled", "billing", true)            written at the event
// rec("ci.result", "ci", true, {ago: 30})            written 30 minutes before the review
const rec = (source, by, value, {ago} = {}) => ({subject: "x", at: AT, recorded: ago === undefined ? AT : NOW - ago, source, by, value});
const answer = (rules, records) => decide(rules, {subject: "x", at: AT, asOf: NOW, records});

const scenarios = {
  "refund agent": {
    rules: `
# May the agent issue this refund without a person?
fact paid from billing.settled owner billing
fact amount in USD_cents range 0..10000000 from orders.refund_amount owner orders
fact fraud_flag from risk.flagged owner risk latest
fact manager_ok from desk.approval owner manager latest
guarantee refund when paid and not fraud_flag and (amount <= 20000 USD_cents or manager_ok)`,
    cases: [
      ["small and clean", [rec("billing.settled", "billing", true), rec("orders.refund_amount", "orders", 5000), rec("risk.flagged", "risk", false)], {refund: "release"}],
      ["risk check not back", [rec("billing.settled", "billing", true), rec("orders.refund_amount", "orders", 5000)], {refund: "hold"}, {refund: ["risk"]}],
      ["large, nobody approved yet", [rec("billing.settled", "billing", true), rec("orders.refund_amount", "orders", 50000), rec("risk.flagged", "risk", false)], {refund: "hold"}, {refund: ["manager"]}],
      ["approval given then withdrawn", [rec("billing.settled", "billing", true), rec("orders.refund_amount", "orders", 50000), rec("risk.flagged", "risk", false), rec("desk.approval", "manager", true, {ago: 90}), rec("desk.approval", "manager", false, {ago: 5})], {refund: "withhold"}],
      ["flagged, amount unknown", [rec("billing.settled", "billing", true), rec("risk.flagged", "risk", true)], {refund: "withhold"}],
    ]},
  "deploy gate": {
    rules: `
fact tests_passed from ci.result owner ci latest within 1440
fact approvals in reviews range 0..50 from pr.approvals owner github latest
fact incident_open from pager.active owner oncall latest within 15
fact window_open from calendar.change_window owner release_manager
guarantee deploy when tests_passed and approvals >= 2 reviews and not incident_open and window_open`,
    cases: [
      ["failed, re-run, passed", [rec("ci.result", "ci", false, {ago: 60}), rec("ci.result", "ci", true, {ago: 20}), rec("pr.approvals", "github", 2), rec("pager.active", "oncall", false, {ago: 3}), rec("calendar.change_window", "release_manager", true)], {deploy: "release"}],
      ["tests are two days old", [rec("ci.result", "ci", true, {ago: 2880}), rec("pr.approvals", "github", 2), rec("pager.active", "oncall", false, {ago: 3}), rec("calendar.change_window", "release_manager", true)], {deploy: "hold"}, {deploy: ["ci"]}],
      ["incident check is stale", [rec("ci.result", "ci", true, {ago: 20}), rec("pr.approvals", "github", 3), rec("pager.active", "oncall", false, {ago: 45}), rec("calendar.change_window", "release_manager", true)], {deploy: "hold"}, {deploy: ["oncall"]}],
      ["one approval", [rec("ci.result", "ci", true, {ago: 20}), rec("pr.approvals", "github", 1), rec("pager.active", "oncall", false, {ago: 3}), rec("calendar.change_window", "release_manager", true)], {deploy: "withhold"}],
      ["incident open, rest unknown", [rec("pager.active", "oncall", true, {ago: 1})], {deploy: "withhold"}],
    ]},
  "outbound email agent": {
    rules: `
fact consent from crm.marketing_consent owner customer latest
fact unsubscribed from crm.unsubscribed owner customer latest
fact sent_this_week in emails range 0..1000 from mail.weekly_count owner mail_service latest within 60
fact region_allowed from compliance.region_ok owner compliance
guarantee send when consent and not unsubscribed and sent_this_week < 3 emails and region_allowed`,
    cases: [
      ["consented, under the cap", [rec("crm.marketing_consent", "customer", true), rec("crm.unsubscribed", "customer", false), rec("mail.weekly_count", "mail_service", 1, {ago: 5}), rec("compliance.region_ok", "compliance", true)], {send: "release"}],
      ["consented, later unsubscribed", [rec("crm.marketing_consent", "customer", true), rec("crm.unsubscribed", "customer", false, {ago: 900}), rec("crm.unsubscribed", "customer", true, {ago: 10}), rec("mail.weekly_count", "mail_service", 1, {ago: 5}), rec("compliance.region_ok", "compliance", true)], {send: "withhold"}],
      ["count not refreshed", [rec("crm.marketing_consent", "customer", true), rec("crm.unsubscribed", "customer", false), rec("mail.weekly_count", "mail_service", 1, {ago: 600}), rec("compliance.region_ok", "compliance", true)], {send: "hold"}, {send: ["mail_service"]}],
      ["consent written by the agent itself", [rec("crm.marketing_consent", "agent", true), rec("crm.unsubscribed", "customer", false), rec("mail.weekly_count", "mail_service", 1, {ago: 5}), rec("compliance.region_ok", "compliance", true)], {send: "hold"}, {send: ["customer"]}],
    ]},
  "wire release": {
    rules: `
fact kyc_passed from kyc.result owner compliance latest within 525600
fact sanctions_clear from screening.clear owner screening latest within 1440
fact amount in USD range 0..100000000 from payments.amount owner treasury
fact approvers in people range 0..20 from payments.approver_count owner treasury latest
fact beneficiary_verified from payments.beneficiary_check owner operations latest
guarantee dual_control when amount <= 10000 USD or approvers >= 2 people
guarantee release_wire when kyc_passed and sanctions_clear and beneficiary_verified and dual_control`,
    cases: [
      ["small, all clear", [rec("kyc.result", "compliance", true, {ago: 9000}), rec("screening.clear", "screening", true, {ago: 30}), rec("payments.amount", "treasury", 900), rec("payments.beneficiary_check", "operations", true)], {release_wire: "release", dual_control: "release"}],
      ["large, one approver", [rec("kyc.result", "compliance", true, {ago: 9000}), rec("screening.clear", "screening", true, {ago: 30}), rec("payments.amount", "treasury", 250000), rec("payments.approver_count", "treasury", 1), rec("payments.beneficiary_check", "operations", true)], {release_wire: "withhold"}],
      ["screening from last week", [rec("kyc.result", "compliance", true, {ago: 9000}), rec("screening.clear", "screening", true, {ago: 10080}), rec("payments.amount", "treasury", 900), rec("payments.beneficiary_check", "operations", true)], {release_wire: "hold"}, {release_wire: ["screening"]}],
      ["screening hit", [rec("screening.clear", "screening", false, {ago: 30})], {release_wire: "withhold"}],
    ]},
  "loan pre-approval": {
    rules: `
fact income_verified from underwriting.income_check owner underwriter
fact score in points range 300..850 from bureau.score owner credit_bureau latest within 43200
fact debt_ratio in percent range 0..500 from underwriting.debt_to_income owner underwriter
fact bankruptcy from bureau.bankruptcy owner credit_bureau
guarantee pre_approve when income_verified and score >= 680 points and debt_ratio <= 43 percent and not bankruptcy
guarantee refer_to_person when income_verified and not bankruptcy and (score < 680 points or debt_ratio > 43 percent)`,
    cases: [
      ["strong file", [rec("underwriting.income_check", "underwriter", true), rec("bureau.score", "credit_bureau", 720, {ago: 100}), rec("underwriting.debt_to_income", "underwriter", 30), rec("bureau.bankruptcy", "credit_bureau", false)], {pre_approve: "release", refer_to_person: "withhold"}],
      ["score missing but ratio too high", [rec("underwriting.income_check", "underwriter", true), rec("underwriting.debt_to_income", "underwriter", 60), rec("bureau.bankruptcy", "credit_bureau", false)], {pre_approve: "withhold", refer_to_person: "release"}],
      ["score missing, ratio fine", [rec("underwriting.income_check", "underwriter", true), rec("underwriting.debt_to_income", "underwriter", 30), rec("bureau.bankruptcy", "credit_bureau", false)], {pre_approve: "hold", refer_to_person: "hold"}, {pre_approve: ["credit_bureau"]}],
      ["score outside the scale", [rec("underwriting.income_check", "underwriter", true), rec("bureau.score", "credit_bureau", 9000, {ago: 100}), rec("underwriting.debt_to_income", "underwriter", 30), rec("bureau.bankruptcy", "credit_bureau", false)], {pre_approve: "hold"}],
    ]},
  "production access": {
    rules: `
fact on_call from pager.on_call owner pager latest within 30
fact ticket_open from tickets.open owner ticketing latest
fact manager_ok from access.approval owner manager latest within 60
fact training_current from hr.security_training owner hr latest
guarantee grant_access when on_call and ticket_open and manager_ok and training_current`,
    cases: [
      ["all current", [rec("pager.on_call", "pager", true, {ago: 5}), rec("tickets.open", "ticketing", true), rec("access.approval", "manager", true, {ago: 20}), rec("hr.security_training", "hr", true)], {grant_access: "release"}],
      ["approval from yesterday", [rec("pager.on_call", "pager", true, {ago: 5}), rec("tickets.open", "ticketing", true), rec("access.approval", "manager", true, {ago: 1500}), rec("hr.security_training", "hr", true)], {grant_access: "hold"}, {grant_access: ["manager"]}],
      ["ticket closed since", [rec("pager.on_call", "pager", true, {ago: 5}), rec("tickets.open", "ticketing", true, {ago: 300}), rec("tickets.open", "ticketing", false, {ago: 10}), rec("access.approval", "manager", true, {ago: 20}), rec("hr.security_training", "hr", true)], {grant_access: "withhold"}],
    ]},
  "shipment release": {
    rules: `
fact paid from billing.settled owner billing
fact address_verified from shipping.address_check owner shipping
fact export_restricted from trade.restricted owner trade_compliance latest
fact in_stock from warehouse.enough_stock owner warehouse latest within 10
guarantee ship when paid and address_verified and not export_restricted and in_stock`,
    cases: [
      ["ready", [rec("billing.settled", "billing", true), rec("shipping.address_check", "shipping", true), rec("trade.restricted", "trade_compliance", false), rec("warehouse.enough_stock", "warehouse", true, {ago: 2})], {ship: "release"}],
      ["stock check an hour old", [rec("billing.settled", "billing", true), rec("shipping.address_check", "shipping", true), rec("trade.restricted", "trade_compliance", false), rec("warehouse.enough_stock", "warehouse", true, {ago: 60})], {ship: "hold"}, {ship: ["warehouse"]}],
      ["two address checks disagree", [rec("billing.settled", "billing", true), rec("shipping.address_check", "shipping", true), rec("shipping.address_check", "shipping", false, {ago: 50}), rec("trade.restricted", "trade_compliance", false), rec("warehouse.enough_stock", "warehouse", true, {ago: 2})], {ship: "hold"}, {ship: ["shipping"]}],
    ]},
  "content publish": {
    rules: `
fact legal_reviewed from legal.review owner counsel latest
fact embargo_lifted from comms.embargo_lifted owner communications latest
fact has_customer_data from privacy.contains_customer_data owner privacy
fact customer_consent from privacy.consent_on_file owner privacy
guarantee publish when legal_reviewed and embargo_lifted and (not has_customer_data or customer_consent)`,
    cases: [
      ["no customer data", [rec("legal.review", "counsel", true), rec("comms.embargo_lifted", "communications", true), rec("privacy.contains_customer_data", "privacy", false)], {publish: "release"}],
      ["customer data, consent unknown", [rec("legal.review", "counsel", true), rec("comms.embargo_lifted", "communications", true), rec("privacy.contains_customer_data", "privacy", true)], {publish: "hold"}, {publish: ["privacy"]}],
      ["embargo still on", [rec("legal.review", "counsel", true), rec("comms.embargo_lifted", "communications", false)], {publish: "withhold"}],
    ]},
  "data deletion request": {
    rules: `
fact identity_verified from requests.identity_check owner privacy_team
fact legal_hold from legal.hold owner counsel latest within 1440
fact retention_elapsed from records.retention_elapsed owner records
guarantee delete_data when identity_verified and not legal_hold and retention_elapsed
guarantee refuse_request when legal_hold`,
    cases: [
      ["clear to delete", [rec("requests.identity_check", "privacy_team", true), rec("legal.hold", "counsel", false, {ago: 100}), rec("records.retention_elapsed", "records", true)], {delete_data: "release", refuse_request: "withhold"}],
      ["hold not checked today", [rec("requests.identity_check", "privacy_team", true), rec("legal.hold", "counsel", false, {ago: 5000}), rec("records.retention_elapsed", "records", true)], {delete_data: "hold", refuse_request: "hold"}, {delete_data: ["counsel"]}],
      ["legal hold", [rec("legal.hold", "counsel", true, {ago: 100})], {delete_data: "withhold", refuse_request: "release"}],
    ]},
  "model release": {
    rules: `
fact eval_score in points range 0..1000 from evals.score owner eval_team latest
fact red_team_signed from safety.red_team_signoff owner safety latest
fact rollback_ready from infra.rollback_ready owner platform latest within 120
fact regressions in cases range 0..100000 from evals.regressions owner eval_team latest
guarantee release_model when eval_score >= 870 points and regressions = 0 cases and red_team_signed and rollback_ready`,
    cases: [
      ["meets the bar", [rec("evals.score", "eval_team", 901), rec("evals.regressions", "eval_team", 0), rec("safety.red_team_signoff", "safety", true), rec("infra.rollback_ready", "platform", true, {ago: 15})], {release_model: "release"}],
      ["rerun found regressions", [rec("evals.score", "eval_team", 901), rec("evals.regressions", "eval_team", 0, {ago: 400}), rec("evals.regressions", "eval_team", 4, {ago: 30}), rec("safety.red_team_signoff", "safety", true), rec("infra.rollback_ready", "platform", true, {ago: 15})], {release_model: "withhold"}],
      ["sign-off pending", [rec("evals.score", "eval_team", 901), rec("evals.regressions", "eval_team", 0), rec("infra.rollback_ready", "platform", true, {ago: 15})], {release_model: "hold"}, {release_model: ["safety"]}],
    ]},
};

let cases = 0;
for (const [name, {rules, cases: list}] of Object.entries(scenarios)) {
  assert.equal(compare(rules, rules).status, "preserved", name);
  for (const [label, records, expected, owners = {}] of list) {
    const got = answer(rules, records);
    for (const [guarantee, status] of Object.entries(expected))
      assert.equal(got[guarantee].status, status, name + " / " + label + " / " + guarantee + ": " + JSON.stringify(got[guarantee]));
    for (const [guarantee, who] of Object.entries(owners))
      assert.deepEqual(got[guarantee].needs.map(need => need.owner), who, name + " / " + label + " asks the wrong owner");
    cases++;
  }
}
console.log(Object.keys(scenarios).length + " everyday gates and " + cases + " cases gave the expected action and named the right owner.");
