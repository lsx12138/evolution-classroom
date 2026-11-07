export const ADAPTER_NAMES=['codex','pi-desktop','minimax-desktop','antigravity'];
export function validSessionId(id,adapter='codex'){
 if(!ADAPTER_NAMES.includes(adapter)||typeof id!=='string')return false;
 return adapter==='minimax-desktop'?/^mvs_[a-f0-9]{32}$/.test(id):/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
}
