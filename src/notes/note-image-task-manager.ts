/**
 * Note Image Task Manager
 * 管理 Note 模式下的并发图片生成任务
 * 使用 Marker 占位符机制确保多任务完成后图片能正确插入
 */

import { Editor, Notice, TFile } from 'obsidian';
import { CanvasAISettings } from '../settings/settings';
import { ApiManager } from '../api/api-manager';
import { t } from '../../lang/helpers';
import type { App } from 'obsidian';

// 图片任务状态
type ImageTaskStatus = 'generating' | 'completed' | 'failed' | 'timeout';

// 单个图片生成任务
interface ImageTask {
    id: string;              // '01', '02'...
    markerId: string;        // '<!-- 🍌 AI generating image #01... -->'
    status: ImageTaskStatus;
    startTime: number;
    abortController: AbortController;
    timeoutId: ReturnType<typeof setTimeout>;
}

// 图片生成选项
interface ImageOptions {
    resolution: string;
    aspectRatio: string;
}

// 输入图片
interface InputImage {
    base64: string;
    mimeType: string;
    role: string;
}

export class NoteImageTaskManager {
    private tasks: Map<string, ImageTask> = new Map();
    private taskCounter = 0;
    private settings: CanvasAISettings;
    private app: App;

    // 用于检测 Edit 操作是否进行中
    private _isEditInProgress = false;

    constructor(app: App, settings: CanvasAISettings) {
        this.app = app;
        this.settings = settings;
    }

    /**
     * 更新设置引用（配置变更时调用）
     */
    updateSettings(settings: CanvasAISettings): void {
        this.settings = settings;
    }

    /**
     * 设置 Edit 进行中状态
     */
    setEditInProgress(value: boolean): void {
        this._isEditInProgress = value;
    }

    /**
     * 检查是否可以启动新的图片生成任务
     */
    canStartImageTask(): boolean {
        const max = this.settings.maxParallelImageTasks || 3;
        return this.tasks.size < max && !this._isEditInProgress;
    }

    /**
     * 检查是否应该禁用 Edit 功能
     * 当有生图任务进行中时，禁用 Edit 以防止 Marker 被破坏
     */
    isEditBlocked(): boolean {
        return this.tasks.size > 0;
    }

    /**
     * 获取当前活跃任务数量
     */
    getActiveTaskCount(): number {
        return this.tasks.size;
    }

    /**
     * 启动一个新的图片生成任务
     */
    async startTask(
        editor: Editor,
        insertPos: { line: number; ch: number },
        prompt: string,
        contextText: string,
        inputImages: InputImage[],
        imageOptions: ImageOptions,
        apiManager: ApiManager,
        file: TFile,
        onSaveImage: (base64: string, file: TFile) => Promise<string>
    ): Promise<void> {
        // 检查是否可以启动
        if (!this.canStartImageTask()) {
            const max = this.settings.maxParallelImageTasks || 3;
            if (this.tasks.size >= max) {
                new Notice(t('Max parallel tasks reached', { max: String(max) }));
            } else if (this._isEditInProgress) {
                new Notice(t('Generation in progress'));
            }
            return;
        }

        // 生成任务 ID 和 Marker
        const taskNum = String(++this.taskCounter).padStart(2, '0');
        const markerId = `<!-- 🍌 AI generating image #${taskNum}... -->`;
        
        const abortController = new AbortController();
        const task: ImageTask = {
            id: taskNum,
            markerId,
            status: 'generating',
            startTime: Date.now(),
            abortController,
            timeoutId: 0 as unknown as ReturnType<typeof setTimeout>
        };
        this.tasks.set(taskNum, task);

        // 插入 Marker 到文档
        editor.replaceRange(`\n${markerId}\n`, insertPos);

        // 设置超时
        const timeoutMs = (this.settings.imageGenerationTimeout || 120) * 1000;
        task.timeoutId = setTimeout(() => this.handleTimeout(task, editor), timeoutMs);

        try {
            // 调用 API 生成图片
            const result = await apiManager.generateImageWithRoles(
                prompt,
                inputImages,
                contextText,
                imageOptions.aspectRatio,
                imageOptions.resolution
            );
            
            clearTimeout(task.timeoutId);

            // 检查任务是否已被取消（超时或手动取消）
            if (!this.tasks.has(taskNum)) {
                return;
            }

            // 保存图片到 vault
            const imagePath = await onSaveImage(result, file);

            // 替换 Marker 为图片
            this.replaceMarkerWithImage(editor, markerId, imagePath);
            task.status = 'completed';

            new Notice(t('Image generated'));

        } catch (e) {
            clearTimeout(task.timeoutId);
            
            // 检查任务是否仍然存在
            if (!this.tasks.has(taskNum)) {
                return;
            }

            if ((e as Error).name !== 'AbortError') {
                task.status = 'failed';
                this.removeMarker(editor, markerId);
                const message = e instanceof Error ? e.message : String(e);
                console.error('Note Image Task: Generation failed:', message);
                new Notice(t('Image generation failed'));
            }
        } finally {
            this.tasks.delete(taskNum);
        }
    }

    /**
     * 替换 Marker 为图片链接
     */
    private replaceMarkerWithImage(editor: Editor, markerId: string, imagePath: string): void {
        const content = editor.getValue();
        const markerIndex = content.indexOf(markerId);
        
        if (markerIndex === -1) {
            // Marker 被用户删除，放弃插入
            console.warn('Note Image Task: Marker not found, skipping image insertion');
            return;
        }

        // 计算 Marker 位置
        const beforeMarker = content.substring(0, markerIndex);
        const linesBefore = beforeMarker.split('\n');
        const line = linesBefore.length - 1;
        const ch = linesBefore[linesBefore.length - 1].length;
        
        const startPos = { line, ch };
        const endPos = { line, ch: ch + markerId.length };

        editor.replaceRange(`![[${imagePath}]]`, startPos, endPos);
    }

    /**
     * 处理超时
     */
    private handleTimeout(task: ImageTask, editor: Editor): void {
        task.abortController.abort();
        task.status = 'timeout';
        this.removeMarker(editor, task.markerId);
        this.tasks.delete(task.id);
        
        const seconds = this.settings.imageGenerationTimeout || 120;
        new Notice(t('Image generation timed out', { seconds: String(seconds) }));
    }

    /**
     * 从文档中移除 Marker
     */
    private removeMarker(editor: Editor, markerId: string): void {
        const content = editor.getValue();
        // 移除 Marker 及其前后的换行符
        const newContent = content.replace(`\n${markerId}\n`, '\n');
        
        if (content !== newContent) {
            // 保存当前光标位置
            const cursor = editor.getCursor();
            editor.setValue(newContent);
            // 尝试恢复光标位置
            editor.setCursor(cursor);
        }
    }

    /**
     * 取消所有任务
     */
    cancelAllTasks(editor: Editor): void {
        for (const task of this.tasks.values()) {
            clearTimeout(task.timeoutId);
            task.abortController.abort();
            this.removeMarker(editor, task.markerId);
        }
        this.tasks.clear();
    }

    /**
     * 销毁管理器
     */
    destroy(): void {
        for (const task of this.tasks.values()) {
            clearTimeout(task.timeoutId);
            task.abortController.abort();
        }
        this.tasks.clear();
    }
}
