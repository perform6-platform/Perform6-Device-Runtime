import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/platform/bsMessagePort.ts', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
} }).outputText;

for (const mode of ['returned', 'missing', 'threw', 'logging-throws']) {
  test(`DOM listener reports ${mode}; failure does not destroy outbound port`, () => {
    const logs = [];
    let callback;
    let instances = 0;
    class Port {
      constructor() {
        instances++;
        if (mode === 'missing') this.addEventListener = undefined;
      }
      PostBSMessage() { return true; }
      addEventListener(type, cb) {
        assert.equal(type, 'bsmessage');
        if (mode === 'threw') throw Error('PRIVATE-EXCEPTION');
        callback = cb;
      }
      set onbsmessage(value) {
        if (mode === 'threw') throw Error('PRIVATE-EXCEPTION');
        callback = value;
      }
    }
    const context = { exports: {}, require: () => { throw Error('NODE-MUST-NOT-BE-USED'); }, window: { BSMessagePort: Port },
      console: { info: (...args) => {
        logs.push(args);
        if (mode === 'logging-throws' && args[0].includes('BRIDGE|')) throw Error('logger failed');
      }, warn: (...args) => logs.push(args) } };
    vm.runInNewContext(code, context);
    const api = context.exports;
    const port = api.getSharedMessagePort();
    assert.equal(port.PostBSMessage({type:'hello'}), true);
    assert.equal(api.getSharedMessagePort(), port);
    assert.equal(instances, 1);
    const record = logs.find(row => row[0] === '[Perform6] BRIDGE|LISTENER')[1];
    assert.equal(record.listenerRegistration, 'skipped-dom-standard');
    assert.equal(record.propertyAssignment, mode === 'threw' ? 'threw' : 'returned');
    assert.equal(record.delivery, 'unconfirmed');
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE-/);
    if (callback) {
      const received = [];
      api.subscribeBsMessages(event => received.push(event.data.type));
      callback({type:'led-hello-ack'});
      callback({data:{type:'led-bridge-pong'}});
      assert.deepEqual(received, ['led-hello-ack', 'led-bridge-pong']);
      assert.equal(logs.filter(row => row[0].includes('callback-entered')).length, 1);
    }
  });
}

test('Node message port is fallback-only when the documented page class is missing', () => {
  const logs = [];
  let callback;
  class NodePort {
    PostBSMessage() { return true; }
    addEventListener(type, cb) {
      assert.equal(type, 'bsmessage');
      callback = cb;
    }
    set onbsmessage(_value) { throw Error('NODE-PROPERTY-MUST-NOT-BE-TOUCHED'); }
  }
  const context = {
    exports: {},
    require: () => NodePort,
    window: {},
    console: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
  };
  vm.runInNewContext(code, context);
  const port = context.exports.getSharedMessagePort();
  assert.ok(port);
  const record = logs.find(row => row[0] === '[Perform6] BRIDGE|LISTENER')[1];
  assert.equal(record.listenerRegistration, 'returned');
  assert.equal(record.propertyAssignment, 'skipped-node-standard');
  const received = [];
  context.exports.subscribeBsMessages(event => received.push(event.data.type));
  callback({ type: 'dom-message' });
  assert.deepEqual(received, ['dom-message']);
});

test('field-proven Node object is the only instance when both constructors exist', () => {
  let nodePosts = 0;
  let nodeListenerRegistrations = 0;
  let nodeCallback;
  let nodeInstances = 0;
  let domInstances = 0;
  class NodePort {
    constructor() { nodeInstances++; }
    PostBSMessage() { nodePosts++; return true; }
    addEventListener(_type, cb) { nodeListenerRegistrations++; nodeCallback = cb; }
  }
  class DomPort {
    constructor() { domInstances++; }
  }
  const context = {
    exports: {},
    require: () => NodePort,
    window: { BSMessagePort: DomPort },
    console: { info() {}, warn() {} },
  };
  vm.runInNewContext(code, context);
  const api = context.exports;
  const outbound = api.getSharedMessagePort();
  outbound.PostBSMessage({ type: 'led-ota-install' });
  assert.equal(nodePosts, 1);
  assert.equal(nodeInstances, 1);
  assert.equal(domInstances, 0);
  assert.equal(nodeListenerRegistrations, 1);
  assert.equal(api.getBridgeTransport(), 'node-messageport');
  assert.equal(api.isBridgeDuplexTransport(), false);
  const received = [];
  api.subscribeBsMessages(event => received.push(event.data.type));
  nodeCallback({ type: 'led-hello-ack' });
  assert.deepEqual(received, ['led-hello-ack']);
  assert.equal(api.isBridgeDuplexTransport(), true);
});

test('Node payload with a legitimate data field is not mistaken for a DOM wrapper', () => {
  let callback;
  class NodePort {
    PostBSMessage() { return true; }
    addEventListener(_type, cb) { callback = cb; }
  }
  const context = {
    exports: {},
    require: () => NodePort,
    window: {},
    console: { info() {}, warn() {} },
  };
  vm.runInNewContext(code, context);
  context.exports.getSharedMessagePort();
  const received = [];
  context.exports.subscribeBsMessages(event => received.push(event.data));
  callback({ type: 'cache-progress', data: { percent: 50 } });
  assert.equal(received[0].type, 'cache-progress');
  assert.equal(received[0].data.percent, 50);
});

test('native hello logging observes exactly one post and cannot log payloads', () => {
  const native = fs.readFileSync('brightsign/autorun.brs', 'utf8');
  const block = native.match(/Sub PostJsToWidget\([^]*?\nEnd Sub/)[0];
  assert.equal((block.match(/html.PostJSMessage\(msg\)/g) || []).length, 1);
  assert.match(block, /accepted = html.PostJSMessage\(msg\)/);
  assert.match(block, /accepted=1\|delivery=unconfirmed/);
  assert.match(block, /accepted=0\|delivery=unconfirmed/);
  assert.doesNotMatch(block, /FormatJson|Reboot|SetUrl|PlayFile|EncryptStorage/);
});
