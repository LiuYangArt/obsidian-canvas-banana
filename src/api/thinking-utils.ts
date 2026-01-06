/**
 * Thinking Processor
 * 处理流式响应中的思考/推理内容，统一格式化为 Markdown Callout
 */

/**
 * 流式响应块，区分思考内容和主内容
 */
export interface StreamChunk {
    /** 主内容增量 */
    content?: string;
    /** 思考内容增量 */
    thinking?: string;
}

/**
 * 处理思考内容的状态机
 * 用于将 <think> 标签、reasoning_content 等统一转换为 Markdown callout
 */
export class ThinkingProcessor {
    private isThinking = false;
    private hasEmittedHeader = false;

    /**
     * 处理一个思考内容增量
     * @returns 格式化后的 markdown 字符串
     */
    processThinking(text: string): string {
        if (!text) return '';
        
        let result = '';
        if (!this.hasEmittedHeader) {
            result = '> [!THINK|no-icon]- Thinking Process\n> ';
            this.hasEmittedHeader = true;
        }
        
        // 缩进换行以保持 callout 格式
        result += text.replace(/\n/g, '\n> ');
        this.isThinking = true;
        return result;
    }

    /**
     * 处理主内容（可能包含 <think> 标签）
     * @returns StreamChunk 区分思考和主内容
     */
    processContent(text: string): StreamChunk {
        if (!text) return {};
        
        const result: StreamChunk = {};
        let remaining = text;

        // 检测 <think> 开始
        if (remaining.includes('<think>')) {
            const parts = remaining.split('<think>');
            if (parts[0]) {
                result.content = parts[0];
            }
            remaining = parts.slice(1).join('<think>');
            this.isThinking = true;
        }

        // 检测 </think> 结束
        if (remaining.includes('</think>')) {
            const parts = remaining.split('</think>');
            if (this.isThinking && parts[0]) {
                result.thinking = this.formatThinking(parts[0]);
            }
            this.isThinking = false;
            if (parts[1]) {
                result.content = (result.content || '') + parts[1];
            }
            return result;
        }

        // 在思考模式中
        if (this.isThinking) {
            result.thinking = this.formatThinking(remaining);
        } else {
            result.content = remaining;
        }

        return result;
    }

    /**
     * 格式化思考文本为 callout
     */
    private formatThinking(text: string): string {
        let result = '';
        if (!this.hasEmittedHeader) {
            result = '> [!THINK|no-icon]- Thinking Process\n> ';
            this.hasEmittedHeader = true;
        }
        result += text.replace(/\n/g, '\n> ');
        return result;
    }

    /**
     * 结束思考块（在流结束时调用）
     */
    endThinking(): string {
        if (this.isThinking && this.hasEmittedHeader) {
            this.isThinking = false;
            return '\n\n';
        }
        return '';
    }

    /**
     * 重置状态
     */
    reset(): void {
        this.isThinking = false;
        this.hasEmittedHeader = false;
    }
}
