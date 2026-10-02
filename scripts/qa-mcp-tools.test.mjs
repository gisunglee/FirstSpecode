/** MCP protocol checks: schemas and API payloads, without network or production data. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../src/lib/mcp/register-tools.ts';

test('MCP metadata PATCH and nullable case fields preserve the public contract', async () => {
  const calls = [];
  const server = new McpServer({name:'qa-test',version:'1.0.0'});
  registerTools(server, async (url, init) => {
    calls.push({url, method:init.method, body:JSON.parse(init.body)});
    return {testSpecId:'s1'};
  });
  const client = new Client({name:'qa-client',version:'1.0.0'});
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st); await client.connect(ct);
    const agreement={userAgreement:'AGREED',discussionSummary:'사용자가 기존 테스트 명세 개요와 케이스 수정 범위를 승인했습니다.'};
    const result = await client.callTool({name:'update_test_spec',arguments:{
      projectId:'p1',testSpecId:'s1',testSpecDc:'updated',...agreement,
    }});
    assert.ok(!result.isError);
    assert.deepEqual(calls[0],{url:'/api/projects/p1/test-specs/s1',method:'PATCH',body:{testSpecDc:'updated'}});
    const changed = await client.callTool({name:'upsert_test_cases',arguments:{
      projectId:'p1',testSpecId:'s1',...agreement,
      cases:[{testCaseId:'c1',ctgryCode:'FUNCTIONAL',scenarioCn:'act',expectedCn:'result',testDataCn:null}],
    }});
    assert.ok(!changed.isError);
    assert.equal(calls[1].body.cases[0].testDataCn,null);
    assert.equal('testAccountCn' in calls[1].body.cases[0],false);
    const rejected = await client.callTool({name:'update_test_spec',arguments:{
      projectId:'p1',testSpecId:'s1',testSpecNm:'blocked',...agreement,userAgreement:'NOT_DISCUSSED',
    }});
    assert.equal(rejected.isError,true); assert.equal(calls.length,2);
  } finally { await client.close(); await server.close(); }
});
