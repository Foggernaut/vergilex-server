// KVKK md.10 aydınlatma + kullanım koşulları — güncel sürüm ve kabul durumu.
//
// LEGAL_VERSIONS, vergilex-web/src/content/legal.ts içindeki PRIVACY_NOTICE.version
// ve TERMS.version ile AYNI olmalıdır. Metin değiştiğinde ikisini birlikte artırın:
// herkesten yeniden kabul istenir (requireAuth → 428, web'de LegalAcceptanceDialog).
// Uyuşmazsa web'in kabul isteği 409 LEGAL_VERSION_MISMATCH alır ("sayfayı yenileyin").
export const LEGAL_VERSIONS = {
  terms_version: '2026-11-23',
  privacy_notice_version: '2026-11-23',
} as const;

/**
 * accepted  — güncel iki sürüm kabul edilmiş
 * required  — kabul kaydı yok ya da eski sürüm (hizmet uçları 428 döner)
 * unknown   — kolonlar yok (023 uygulanmamış DB): engelleme yapılmaz
 */
export type LegalState = 'accepted' | 'required' | 'unknown';

export function legalAcceptanceState(row: Record<string, unknown>): LegalState {
  if (!('terms_version' in row) && !('privacy_notice_version' in row)) return 'unknown';
  return row.terms_version === LEGAL_VERSIONS.terms_version &&
    row.privacy_notice_version === LEGAL_VERSIONS.privacy_notice_version
    ? 'accepted'
    : 'required';
}

/**
 * Kabul etmeden kullanılabilen router'lar (req.baseUrl): oturum (çıkış) ve hesap
 * yönetimi. KVKK md.11 haklarını (dışa aktarma, silme) kabul şartına bağlamayız;
 * kabul ucu da buradadır. Diğer HER router — gelecekte eklenenler dahil — kapalıdır.
 */
export const LEGAL_EXEMPT_BASES: ReadonlySet<string> = new Set(['/api/auth', '/api/user']);

export const TERMS_REQUIRED_MESSAGE =
  'Devam etmek için güncel Aydınlatma Metni ve Kullanım Koşulları’nı kabul etmeniz gerekiyor.';

/** Profil yanıtı: users satırından bilinen alanlar; 023 kolonları varsa onlar da. */
export function toProfile(row: Record<string, unknown>) {
  const profile: Record<string, unknown> = {
    id: row.id,
    email: row.email,
    full_name: row.full_name ?? null,
    role: row.role,
    credits: row.credits,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  for (const k of ['terms_version', 'privacy_notice_version', 'terms_accepted_at'] as const) {
    if (k in row) profile[k] = row[k] ?? null;
  }
  return profile;
}
