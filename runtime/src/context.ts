
import { Base64 } from "js-base64";

export interface VMContext {
  current_account_id: string;
  signer_account_id: string;
  signer_account_pk: string
  predecessor_account_id: string
  //Base64 encoded
  // input_str: string;
  input: string // = bs64.encode(input_str);
  block_index: number
  block_timestamp: number;
  epoch_height: number;
  account_balance: string;
  account_locked_balance: string;
  storage_usage: number;
  attached_deposit: string;
  prepaid_gas: number;
  random_seed: string 
  is_view: boolean;
  output_data_receivers: Array<any>
}

export function defaultContext(): VMContext {
  return {
    input:"{}",
    output_data_receivers: [],
    prepaid_gas: 10**15,
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
  }

}

export interface AccountContext {
  current_account_id: string;
  signer_account_id: string;
  signer_account_pk: string;
  predecessor_account_id: string;
  input: string;
  input_data: any[];
  account_balance: string;
  account_locked_balance: string;
  output_data_receivers: any[];
  prepaid_gas: number;
  attached_deposit: string;
  is_view: boolean;
}

export function defaultAccountContext(): Partial<AccountContext> {
  return {
    input:"{}",
    input_data: [],
    output_data_receivers: [],
    prepaid_gas: 10**15,
    attached_deposit: "0",
    is_view: false,
  }
}

export function prepareContext(vmcontext: VMContext): VMContext {
  vmcontext.input = Base64.encode(vmcontext.input);
  return vmcontext;
}

export function createContext(accountContext: AccountContext): VMContext {
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
 