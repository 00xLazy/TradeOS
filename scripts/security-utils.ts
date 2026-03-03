/**
 * security-utils.ts - 安全相关工具函数
 */

/**
 * 过滤文本中的敏感字段（API Key、Secret、签名、长 token 等）。
 */
export function sanitizeSensitiveText(input: string): string {
  let text = input;

  // 屏蔽常见密钥字段
  text = text.replace(/(api[_-]?key|secret|passphrase|signature)\s*[=:]\s*([^\s&'",}]+)/gi, '$1=***');

  // 屏蔽形如 access_token=xxx / token: xxx
  text = text.replace(/(access[_-]?token|token)\s*[=:]\s*([^\s&'",}]+)/gi, '$1=***');

  // 屏蔽疑似长 token（16-128 位字母数字/下划线/中划线）
  text = text.replace(/[A-Za-z0-9_-]{16,128}/g, (match: string) => {
    if (/^(https?|wss?|ftp)/i.test(match)) return match;
    return `${match.slice(0, 4)}***`;
  });

  return text;
}

/**
 * 将任意错误对象转为安全可展示文本。
 */
export function sanitizeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return sanitizeSensitiveText(err.message);
  }
  return sanitizeSensitiveText(String(err));
}
