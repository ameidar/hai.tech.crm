/** Meta failure → human-readable reason, e.g. "131049: This message was not delivered to maintain healthy ecosystem engagement." */
export function describeMetaStatusError(status: any): { code: number | null; message: string | null } {
  const err = Array.isArray(status?.errors) ? status.errors[0] : null;
  if (!err) return { code: null, message: null };
  const code = Number.isFinite(Number(err.code)) ? Number(err.code) : null;
  const text = err.error_data?.details || err.message || err.title || null;
  return { code, message: text ? `${code ?? ''}${code ? ': ' : ''}${text}` : (code ? String(code) : null) };
}
