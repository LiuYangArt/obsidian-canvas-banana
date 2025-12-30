/**
 * Text Patcher - Diff-based Text Replacement
 * 处理 AI 返回的修改补丁，支持模糊匹配
 */

export interface TextChange {
    original: string;
    new: string;
}

export interface PatchResult {
    success: boolean;
    text: string;
    appliedCount: number;
    failedPatches: TextChange[];
}

/**
 * 计算两个字符串的相似度 (Levenshtein Distance)
 */
function levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= a.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // 删除
                matrix[i][j - 1] + 1,      // 插入
                matrix[i - 1][j - 1] + cost // 替换
            );
        }
    }

    return matrix[a.length][b.length];
}

/**
 * 计算相似度 (0-1，1 为完全匹配)
 */
function similarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    const maxLen = Math.max(a.length, b.length);
    const distance = levenshteinDistance(a, b);
    return 1 - distance / maxLen;
}

/**
 * 规范化文本用于匹配 (去除多余空白)
 */
function normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * 在文档中查找最佳匹配位置
 * 返回 [startIndex, endIndex] 或 null
 */
function findBestMatch(
    docContent: string,
    searchText: string,
    minSimilarity: number = 0.8
): { start: number; end: number; matchedText: string } | null {
    // 精确匹配
    const exactIndex = docContent.indexOf(searchText);
    if (exactIndex !== -1) {
        return {
            start: exactIndex,
            end: exactIndex + searchText.length,
            matchedText: searchText
        };
    }

    // 规范化匹配
    const normalizedSearch = normalizeText(searchText);
    const normalizedDoc = normalizeText(docContent);
    const normalizedIndex = normalizedDoc.indexOf(normalizedSearch);

    if (normalizedIndex !== -1) {
        // 需要映射回原文档位置 - 使用滑动窗口
        const windowSize = Math.ceil(searchText.length * 1.2);
        let bestMatch: { start: number; end: number; matchedText: string; sim: number } | null = null;

        for (let i = 0; i <= docContent.length - searchText.length / 2; i++) {
            const windowEnd = Math.min(i + windowSize, docContent.length);
            const window = docContent.substring(i, windowEnd);
            const sim = similarity(normalizeText(window), normalizedSearch);

            if (sim > minSimilarity && (!bestMatch || sim > bestMatch.sim)) {
                // 精确定位结束位置
                let end = windowEnd;
                for (let j = windowEnd; j > i; j--) {
                    const subWindow = docContent.substring(i, j);
                    if (similarity(normalizeText(subWindow), normalizedSearch) >= sim) {
                        end = j;
                        break;
                    }
                }
                bestMatch = { start: i, end, matchedText: docContent.substring(i, end), sim };
            }
        }

        if (bestMatch) {
            return { start: bestMatch.start, end: bestMatch.end, matchedText: bestMatch.matchedText };
        }
    }

    // 模糊匹配 - 滑动窗口
    const windowSize = searchText.length;
    let bestMatch: { start: number; end: number; matchedText: string; sim: number } | null = null;

    for (let i = 0; i <= docContent.length - windowSize / 2; i++) {
        for (let len = Math.floor(windowSize * 0.7); len <= Math.ceil(windowSize * 1.3); len++) {
            if (i + len > docContent.length) break;

            const window = docContent.substring(i, i + len);
            const sim = similarity(window, searchText);

            if (sim >= minSimilarity && (!bestMatch || sim > bestMatch.sim)) {
                bestMatch = { start: i, end: i + len, matchedText: window, sim };
            }
        }
    }

    return bestMatch ? { start: bestMatch.start, end: bestMatch.end, matchedText: bestMatch.matchedText } : null;
}

/**
 * 应用文本补丁到文档
 * @param docContent 原始文档内容
 * @param patches 修改补丁列表
 * @param minSimilarity 最小相似度阈值 (默认 0.8)
 */
export function applyPatches(
    docContent: string,
    patches: TextChange[],
    minSimilarity: number = 0.8
): PatchResult {
    let currentContent = docContent;
    let appliedCount = 0;
    const failedPatches: TextChange[] = [];

    // 按原文长度降序排列，先处理长文本避免冲突
    const sortedPatches = [...patches].sort((a, b) => b.original.length - a.original.length);

    for (const patch of sortedPatches) {
        const match = findBestMatch(currentContent, patch.original, minSimilarity);

        if (match) {
            currentContent =
                currentContent.substring(0, match.start) +
                patch.new +
                currentContent.substring(match.end);
            appliedCount++;
        } else {
            failedPatches.push(patch);
            console.debug('Text Patcher: Failed to match patch:', patch.original.substring(0, 50));
        }
    }

    return {
        success: failedPatches.length === 0,
        text: currentContent,
        appliedCount,
        failedPatches
    };
}

/**
 * 解析 AI 响应中的 patches
 * 支持 JSON 格式和 Search/Replace 块格式
 */
export function parseAIPatches(response: string): TextChange[] {
    const patches: TextChange[] = [];

    // 清理 markdown 代码块
    let content = response.trim();
    if (content.startsWith('```json')) {
        content = content.slice(7);
    }
    if (content.startsWith('```')) {
        content = content.slice(3);
    }
    if (content.endsWith('```')) {
        content = content.slice(0, -3);
    }
    content = content.trim();

    // 尝试 JSON 格式
    try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
            for (const item of parsed) {
                if (item.original && item.new !== undefined) {
                    patches.push({ original: item.original, new: item.new });
                }
            }
            if (patches.length > 0) return patches;
        }
    } catch {
        // 非 JSON 格式
    }

    // 尝试 Search/Replace 块格式
    // <<<< SEARCH
    // original text
    // ====
    // new text
    // >>>> REPLACE
    const blockRegex = /<<<<\s*SEARCH\s*\n([\s\S]*?)\n====\s*\n([\s\S]*?)\n>>>>\s*REPLACE/gi;
    let match;
    while ((match = blockRegex.exec(content)) !== null) {
        patches.push({
            original: match[1].trim(),
            new: match[2].trim()
        });
    }

    return patches;
}
