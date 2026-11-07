/**
 * "Did you mean" 候选（mod 62）：语义诊断把未知表/列/别名与元数据候选做
 * 大小写不敏感的 Damerau-Levenshtein（相邻换位算 1 处编辑——"urs"→"usr"
 * 是最常见的笔误形态）匹配，距离在阈值内的前几个作为一键替换项。
 * 阈值随词长放宽（每 4 个字符允许 1 处编辑，至少 1），过短的词（<3）噪声
 * 太大，直接不给候选。补全场景可开 matchCandidatePrefix 容忍"打了一半"的
 * 短词与长候选的前缀差异（usre→user_id）。
 */

function damerauLevenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let twoAgo: number[] | null = null;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let index = 1; index <= a.length; index += 1) {
    const current = [index];
    for (let jndex = 1; jndex <= b.length; jndex += 1) {
      const substitutionCost = a[index - 1] === b[jndex - 1] ? 0 : 1;
      let value = Math.min(previous[jndex]! + 1, current[jndex - 1]! + 1, previous[jndex - 1]! + substitutionCost);
      if (index > 1 && jndex > 1 && a[index - 1] === b[jndex - 2] && a[index - 2] === b[jndex - 1]) {
        value = Math.min(value, twoAgo![jndex - 2]! + 1);
      }
      current[jndex] = value;
    }
    twoAgo = previous;
    previous = current;
  }
  return previous[b.length]!;
}

function normalizeForComparison(value: string): string {
  let normalized = value;
  while (normalized && `"'\`[]`.includes(normalized[0])) normalized = normalized.slice(1);
  while (normalized && `"'\`[]`.includes(normalized[normalized.length - 1])) normalized = normalized.slice(0, -1);
  return normalized.toLowerCase();
}

/** 距离阈值：每 4 个字符容忍 1 处编辑，下限 1（"custumer_id"→"customer_id" 距离 1）。 */
export function sqlQuickFixDistanceThreshold(name: string): number {
  return Math.max(1, Math.floor(name.length / 4));
}

export interface SqlQuickFixSuggestionOptions {
  /**
   * 补全场景（mod 62）专用：同时拿候选的同长度前缀来比距离，这样还在打字中的
   * 短词（"usre"→user_id 的前缀 "user"，换位距离 1）也能命中长得多的列名。
   * 完全匹配前缀的词（"user"）本来就会走常规补全，不会落到 did-you-mean，
   * 所以该模式不会与常规补全重复。诊断场景（默认关闭）保持整词比较。
   */
  matchCandidatePrefix?: boolean;
}

/**
 * 返回与 `name` 最相近的候选（最多 `limit` 个，默认 3），按距离升序、
 * 同首字母优先、再字典序。没有够近的候选时返回空数组。
 */
export function sqlQuickFixSuggestions(name: string, candidates: readonly string[], limit = 3, options?: SqlQuickFixSuggestionOptions): string[] {
  const normalized = normalizeForComparison(name);
  if (normalized.length < 3) return [];
  const threshold = sqlQuickFixDistanceThreshold(normalized);
  const matchPrefix = options?.matchCandidatePrefix === true;

  const seen = new Set<string>();
  const ranked: { candidate: string; distance: number; sameFirstLetter: number }[] = [];
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const candidateNormalized = normalizeForComparison(trimmed);
    if (!candidateNormalized || candidateNormalized === normalized) continue;
    const cacheKey = candidateNormalized;
    if (seen.has(cacheKey)) continue;
    seen.add(cacheKey);
    let distance = damerauLevenshteinDistance(normalized, candidateNormalized);
    if (matchPrefix && distance > threshold && candidateNormalized.length > normalized.length) {
      // 只接受"前缀的近似"：与候选同长度前缀距离 0（打了一半的正确前缀）不算
      // 笔误，那属于常规补全的领地，不能抢。
      const prefixDistance = damerauLevenshteinDistance(normalized, candidateNormalized.slice(0, normalized.length));
      if (prefixDistance > 0) distance = Math.min(distance, prefixDistance);
    }
    if (distance > threshold) continue;
    ranked.push({ candidate: trimmed, distance, sameFirstLetter: candidateNormalized[0] === normalized[0] ? 0 : 1 });
  }
  ranked.sort((left, right) => left.distance - right.distance || left.sameFirstLetter - right.sameFirstLetter || left.candidate.localeCompare(right.candidate));
  return ranked.slice(0, limit).map((item) => item.candidate);
}
