import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';

// 插件设置接口
interface CanvasAISettings {
    // Gemini API 密钥
    geminiApiKey: string;
    // OpenRouter API 密钥
    openRouterApiKey: string;
}

// 默认设置
const DEFAULT_SETTINGS: CanvasAISettings = {
    geminiApiKey: '',
    openRouterApiKey: ''
};

/**
 * Canvas AI 插件主类
 * 在 Obsidian Canvas 视图中集成 Gemini AI
 */
export default class CanvasAIPlugin extends Plugin {
    settings: CanvasAISettings;

    async onload() {
        console.log('Canvas AI: 插件加载中...');

        // 加载设置
        await this.loadSettings();

        // 添加设置页面
        this.addSettingTab(new CanvasAISettingTab(this.app, this));

        console.log('Canvas AI: 插件加载完成');
    }

    onunload() {
        console.log('Canvas AI: 插件已卸载');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

/**
 * Canvas AI 设置页面
 */
class CanvasAISettingTab extends PluginSettingTab {
    plugin: CanvasAIPlugin;

    constructor(app: App, plugin: CanvasAIPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        // 页面标题
        containerEl.createEl('h2', { text: 'Canvas AI 设置' });

        // Gemini API 设置区域
        containerEl.createEl('h3', { text: 'API 配置' });

        // Gemini API Key 输入
        new Setting(containerEl)
            .setName('Gemini API Key')
            .setDesc('输入你的 Google Gemini API 密钥')
            .addText(text => text
                .setPlaceholder('输入 API Key...')
                .setValue(this.plugin.settings.geminiApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.geminiApiKey = value;
                    await this.plugin.saveSettings();
                }));

        // OpenRouter API Key 输入
        new Setting(containerEl)
            .setName('OpenRouter API Key')
            .setDesc('输入你的 OpenRouter API 密钥（可选）')
            .addText(text => text
                .setPlaceholder('输入 API Key...')
                .setValue(this.plugin.settings.openRouterApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.openRouterApiKey = value;
                    await this.plugin.saveSettings();
                }));

        // 关于区域
        containerEl.createEl('h3', { text: '关于' });
        containerEl.createEl('p', {
            text: 'Canvas AI 插件允许你在 Obsidian Canvas 中使用 Gemini AI 进行对话、文本生成和图像生成。'
        });
    }
}
