// VS Code extension test entry. Call the ordinary Format Document command and read the saved file.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const vscode = require("vscode");
exports.run = async function () {
  const {workspace, window, commands, extensions} = vscode;
  assert.ok(workspace.isTrusted, "only use the isolated, trusted synthetic workspace");
  const ext=extensions.getExtension("esbenp.prettier-vscode");
  await ext.activate();
  await extensions.getExtension("vscode.typescript-language-features").activate();
  const result={};
  for (const folder of workspace.workspaceFolders) {
    const file=vscode.Uri.joinPath(folder.uri,"sample.js");
    const doc=await workspace.openTextDocument(file);
    await window.showTextDocument(doc);
    const before=doc.getText();
    await commands.executeCommand("editor.action.formatDocument");
    assert.ok(await doc.save());
    const after=fs.readFileSync(file.fsPath,"utf8");
    assert.equal(after,doc.getText());
    result[folder.name]={before,after,release:ext.packageJSON.version};
  }
  const dest=path.join(process.env.PHASELINE_EXAM_HOME,"host-"+ext.packageJSON.version);
  fs.writeFileSync(path.join(dest,"observations.json"),JSON.stringify(result,null,2));
};
