/**
 * HTML escaping for Telegram's `parse_mode: 'HTML'`.
 *
 * Telegram only requires `<`, `>`, and `&` to be escaped inside text, plus the
 * usual entity rules. See https://core.telegram.org/bots/api#html-style.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = { escapeHtml };
