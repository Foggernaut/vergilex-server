// Soru uzunluğu tavanı (karakter) — beyin (models/requests.py MAX_QUERY_CHARS) ve web ile aynı.
// 1000 → 4000 (2026-10-18): somut olay anlatan uzun sorular 1000'i aşıp doğrulamada 0 ms'de
// 400 alıyordu; soru beyne hiç ulaşmıyor, kullanıcı belirsiz bir hata görüyordu.
export const MIN_QUERY_CHARS = 2;
export const MAX_QUERY_CHARS = 4000;
