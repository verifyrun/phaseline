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
    // The extension registers some providers asynchronously per workspace folder.
    // Exercise a distinct file so a readiness event cannot be mistaken for the measured save.
    const probe=vscode.Uri.joinPath(folder.uri,"ready.js");
    fs.writeFileSync(probe.fsPath,"const ready=1;\n");
    const probeDoc=await workspace.openTextDocument(probe);
    await window.showTextDocument(probeDoc);
    const deadline=Date.now()+10000;
    while (probeDoc.getText()!=="const ready = 1;\n" && Date.now()<deadline) {
      await commands.executeCommand("editor.action.formatDocument");
      if (probeDoc.getText()!=="const ready = 1;\n") await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(probeDoc.getText(),"const ready = 1;\n","provider did not handle readiness probe");
    await probeDoc.save();
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
