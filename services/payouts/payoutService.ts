export type PayoutRequest = {
  userId: string;
  amount: number;
  routingNumber: string;
  accountNumber: string;
  accountHolderName: string;
  requestId: string;
};

export type PayoutResult = {
  success: boolean;
  transactionId?: string;
  error?: string;
};

// ACTIVE: Manual flow - requests are fulfilled manually through Mercury.
export async function sendPayout(_request: PayoutRequest): Promise<PayoutResult> {
  return { success: true };
}

// STUB: Checkbook integration - wire in when approved.
// export async function sendPayoutViaCheckbook(request: PayoutRequest): Promise<PayoutResult> {
//   const response = await fetch("https://api.checkbook.io/v3/check/digital", {
//     method: "POST",
//     headers: {
//       Authorization: `Basic ${CHECKBOOK_API_KEY}`,
//       "Content-Type": "application/json",
//     },
//     body: JSON.stringify({
//       recipient: request.accountHolderName,
//       routing_number: request.routingNumber,
//       account_number: request.accountNumber,
//       amount: request.amount,
//       description: "Wello Cashback Payout",
//     }),
//   });
//   const data = await response.json();
//   return { success: response.ok, transactionId: data.id, error: data.error };
// }

