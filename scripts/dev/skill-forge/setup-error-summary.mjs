// Log bounded categories only: RPC errors can embed credential-bearing URLs,
// request calldata and arbitrary remote messages in every cause level.
const names = new Set(['Error','TypeError','HttpRequestError','CallExecutionError',
  'ContractFunctionExecutionError','RpcRequestError','TimeoutError','SocketError',
  'ConnectTimeoutError','HeadersTimeoutError','BodyTimeoutError']);
const codes = new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','EPIPE',
  'UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
export function setupErrorSummary(error) {
  const result=[],seen=new Set();
  for(let current=error;current&&typeof current==='object'&&!seen.has(current)&&result.length<6;current=current.cause){
    seen.add(current);
    result.push({name:names.has(current.name)?current.name:'OtherError',
      ...(Number.isSafeInteger(current.code)||codes.has(current.code)?{code:current.code}:{}),
      ...(Number.isInteger(current.status)&&current.status>=100&&current.status<=599?{status:current.status}:{})});
  }
  return result;
}
