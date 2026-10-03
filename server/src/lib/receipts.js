// Sequential receipt numbers for real payments: OR-000001, OR-000002, …
// Never resets. Call inside the same $transaction as the PAYMENT insert so the
// counter and the row commit together.
export async function nextReceiptNo(tx) {
  const row = await tx.counter.upsert({
    where: { key: 'receipt' },
    create: { key: 'receipt', value: 1 },
    update: { value: { increment: 1 } },
  })
  return 'OR-' + String(row.value).padStart(6, '0')
}
