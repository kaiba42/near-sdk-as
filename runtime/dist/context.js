"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const js_base64_1 = require("js-base64");
function defaultContext() {
    return {
        input: "{}",
        output_data_receivers: [],
        prepaid_gas: 10 ** 15,
        attached_deposit: "0",
        is_view: false,
        block_index: 1,
        block_timestamp: 1585778575325000000,
        epoch_height: 1,
        storage_usage: 100,
        random_seed: "KuTCtARNzxZQ3YvXDeLjx83FDqxv2SdQTSbiq876zR7",
        current_account_id: "alice",
        signer_account_id: "alice",
        predecessor_account_id: "bob",
        account_balance: "1000",
        signer_account_pk: "KuTCtARNzxZQ3YvXDeLjx83FDqxv2SdQTSbiq876zR7",
        account_locked_balance: "10"
    };
}
exports.defaultContext = defaultContext;
function defaultAccountContext() {
    return {
        input: "{}",
        input_data: [],
        output_data_receivers: [],
        prepaid_gas: 10 ** 15,
        attached_deposit: "0",
        is_view: false
    };
}
exports.defaultAccountContext = defaultAccountContext;
function prepareContext(vmcontext) {
    vmcontext.input = js_base64_1.Base64.encode(vmcontext.input);
    return vmcontext;
}
exports.prepareContext = prepareContext;
function createContext(accountContext) {
    const context = defaultContext();
    for (let key of Object.getOwnPropertyNames(context)) {
        //@ts-ignore
        if (accountContext[key] != undefined) {
            //@ts-ignore
            context[key] = accountContext[key];
        }
    }
    return prepareContext(context);
}
exports.createContext = createContext;
//# sourceMappingURL=context.js.map