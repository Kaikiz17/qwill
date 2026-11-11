import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { openEvmWindowMsg } from "@qorechain/sdk";
import { encodeOpenEvmWindow } from "../src/lib/qwill/window-bytes.mjs";

test("scoped window bytes match the QoreChain SDK", async () => {
  const srcPath = path.resolve("node_modules/@qorechain/sdk/dist/index.js");
  const src = fs.readFileSync(srcPath, "utf8");
  assert.match(src, /var MsgOpenEVMWindow = \{/);
  const hooked = src.replace("\nexport {", "\nexport { MsgOpenEVMWindow };\nexport {");
  const dest = path.join(path.dirname(srcPath), `qwill-hook-${Date.now()}.mjs`);
  fs.writeFileSync(dest, hooked);
  try {
    const mod = await import(pathToFileURL(dest).href);
    const msg = openEvmWindowMsg({
      sender: "qor1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg34kqp8d",
      blocks: 7200,
      maxTxs: 20,
      maxValue: "5000000",
      allowedTargets: ["0x2222222222222222222222222222222222222222"],
    });
    const official = Buffer.from(mod.MsgOpenEVMWindow.encode(msg.value).finish());
    const ours = Buffer.from(encodeOpenEvmWindow(msg.value));
    assert.deepEqual(ours, official);
    assert.ok(ours.includes(Buffer.from("0x2222222222222222222222222222222222222222")));
  } finally {
    fs.unlinkSync(dest);
  }
});
