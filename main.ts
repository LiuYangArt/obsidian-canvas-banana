import { ItemView, Notice, Plugin, setIcon, setTooltip, TFile, WorkspaceLeaf, Menu, MenuItem } from 'obsidian';
import type { Canvas, CanvasNode, CanvasCoords, CanvasView, SelectionContext } from './src/types';
import { CanvasConverter } from './src/canvas/canvas-converter';
import { ApiManager } from './src/api/api-manager';
import { IntentResolver, ResolvedIntent, NodeEditIntent } from './src/canvas/intent-resolver';
import { extractCanvasJSON, remapCoordinates, regenerateIds, optimizeLayout, sanitizeCanvasData } from './src/canvas/node-mode-utils';
import { t } from './lang/helpers';
import { ApiProvider, QuickSwitchModel, PromptPreset, CanvasAISettings, DEFAULT_SETTINGS } from './src/settings/settings';
import { DEFAULT_NODE_MODE_PROMPT, buildEditModeSystemPrompt } from './src/prompts';
import { debugSelectedNodes } from './src/utils/debug';
import { CanvasAISettingTab } from './src/settings/settings-tab';
import { DiffModal } from './src/ui/modals';
import { FloatingPalette, PaletteMode } from './src/ui/floating-palette';
import { NotesSelectionHandler, SideBarCoPilotView, VIEW_TYPE_SIDEBAR_COPILOT } from './src/notes';
import { openImageInNewWindow, copyImageToClipboard } from './src/canvas/image-viewer';
import { createGroupFromSelection, createNewNodeAtCenter, selectConnectedNodes } from './src/canvas/node-operations';
import { GhostNodeManager } from './src/core/ghost-node-manager';


// Re-export for backward compatibility
export type { ApiProvider, QuickSwitchModel, PromptPreset, CanvasAISettings };


// AI Button ID constant for popup menu
const AI_SPARKLES_BUTTON_ID = 'canvas-ai-sparkles';

export default class CanvasAIPlugin extends Plugin {
    settings: CanvasAISettings;

    public floatingPalette: FloatingPalette | null = null;
    private lastSelectionSize: number = 0;
    private lastSelectedIds: Set<string> = new Set();
    // Cache the last valid text selection from node edit mode
    public lastTextSelectionContext: SelectionContext | null = null;
    private hideTimer: number | null = null;
    public apiManager: ApiManager | null = null;
    // Ghost Node 管理器
    public ghostNodeManager: GhostNodeManager | null = null;
    // Track the popout leaf for single window mode
    private imagePopoutLeaf: WorkspaceLeaf | null = null;
    // Flag to track if user has interacted with non-AI elements (potentially changing selection)
    private selectionInteractionFlag: boolean = false;
    // Notes AI handler
    private notesHandler: NotesSelectionHandler | null = null;

    /**
     * 供侧栏访问 NotesSelectionHandler
     */
    public getNotesHandler(): NotesSelectionHandler | null {
        return this.notesHandler;
    }


    async onload() {
        console.debug('Canvas Banana: Plugin loading...');

        await this.loadSettings();

        // Migration: Move legacy settings to OpenRouter settings if needed
        if (this.settings.textModel && !this.settings.openRouterTextModel) {
            this.settings.openRouterTextModel = this.settings.textModel;
            this.settings.textModel = undefined; // Clear legacy
        }
        if (this.settings.imageModel && !this.settings.openRouterImageModel) {
            this.settings.openRouterImageModel = this.settings.imageModel;
            this.settings.imageModel = undefined;
        }
        if (this.settings.useCustomTextModel !== undefined && this.settings.openRouterUseCustomTextModel === undefined) {
            // @ts-ignore
            this.settings.openRouterUseCustomTextModel = this.settings.useCustomTextModel;
            this.settings.useCustomTextModel = undefined;
        }
        if (this.settings.useCustomImageModel !== undefined && this.settings.openRouterUseCustomImageModel === undefined) {
            // @ts-ignore
            this.settings.openRouterUseCustomImageModel = this.settings.useCustomImageModel;
            this.settings.useCustomImageModel = undefined;
        }

        // Migration: Rename chatSystemPrompt to textSystemPrompt
        // @ts-ignore
        if (this.settings.chatSystemPrompt !== undefined) {
            // Only migrate if textSystemPrompt is still default or empty
            if (!this.settings.textSystemPrompt || this.settings.textSystemPrompt === DEFAULT_SETTINGS.textSystemPrompt) {
                // @ts-ignore
                this.settings.textSystemPrompt = this.settings.chatSystemPrompt;
            }
            // @ts-ignore
            this.settings.chatSystemPrompt = undefined;
        }

        await this.saveSettings();

        // Register settings tab
        this.addSettingTab(new CanvasAISettingTab(this.app, this));

        this.initFloatingComponents();

        this.registerCanvasSelectionListener();

        // Register Canvas utility hotkeys

        // Register Canvas utility hotkeys
        this.registerCanvasUtilities();

        // Initialize Notes AI handler
        this.notesHandler = new NotesSelectionHandler(this);

        // Register Sidebar CoPilot View
        this.registerView(
            VIEW_TYPE_SIDEBAR_COPILOT,
            (leaf) => new SideBarCoPilotView(leaf, this)
        );

        // Add Ribbon icon for Sidebar CoPilot (at the bottom)
        const ribbonIcon = this.addRibbonIcon('banana', t('Canvas Banana'), () => {
            void this.toggleSidebarCoPilot();
        });
        // Move to bottom of ribbon
        ribbonIcon.parentElement?.appendChild(ribbonIcon);

        console.debug('Canvas Banana: Plugin loaded');
    }

    /**
     * Toggle Sidebar CoPilot visibility
     */
    private async toggleSidebarCoPilot(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR_COPILOT);
        if (existing.length > 0) {
            // Close existing view
            existing.forEach(leaf => leaf.detach());
        } else {
            // Open new view in right sidebar
            const leaf = this.app.workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({
                    type: VIEW_TYPE_SIDEBAR_COPILOT,
                    active: true
                });
                void this.app.workspace.revealLeaf(leaf);
            }
        }
    }

    onunload() {
        console.debug('Canvas Banana: Plugin unloading...');

        this.floatingPalette?.destroy();
        this.notesHandler?.destroy();

        console.debug('Canvas Banana: Plugin unloaded');
    }

    private initFloatingComponents(): void {
        // Initialize API Manager
        this.apiManager = new ApiManager(this.settings);

        // Initialize Ghost Node Manager
        this.ghostNodeManager = new GhostNodeManager(this.app);

        this.floatingPalette = new FloatingPalette(this.app, this.apiManager, (mode) => {
            void debugSelectedNodes(
                this.app,
                mode,
                this.settings,
                () => this.floatingPalette?.getPrompt() || '',
                this.lastTextSelectionContext
            );
        });

        // Set up generate callback for Ghost Node creation
        this.floatingPalette.setOnGenerate(async (prompt: string, mode: PaletteMode) => {
            await this.handleGeneration(prompt, mode);
        });

        // Set up settings change callback for persisting image options
        this.floatingPalette.setOnSettingsChange((key, value) => {
            if (key === 'aspectRatio') {
                this.settings.defaultAspectRatio = value;
            } else if (key === 'resolution') {
                this.settings.defaultResolution = value;
            }

            void this.saveSettings();
        });


        // Set up preset change callback for persisting presets
        this.floatingPalette.setOnPresetChange((presets, mode) => {
            if (mode === 'text') {
                this.settings.chatPresets = presets;
            } else if (mode === 'image') {
                this.settings.imagePresets = presets;
            } else if (mode === 'node') {
                this.settings.nodePresets = presets;
            } else {
                this.settings.editPresets = presets;
            }
            void this.saveSettings();
        });

        // Initialize palette with saved settings
        this.floatingPalette.initImageOptions(
            this.settings.defaultAspectRatio,
            this.settings.defaultResolution
        );

        // Initialize presets from saved settings

        this.floatingPalette.initPresets(
            this.settings.chatPresets || [],
            this.settings.imagePresets || [],
            this.settings.nodePresets || [],
            this.settings.editPresets || []
        );

        // Initialize debug mode from settings
        this.floatingPalette.setDebugMode(this.settings.debugMode);

        // Initialize quick switch models from settings
        this.floatingPalette.initQuickSwitchModels(
            this.settings.quickSwitchTextModels || [],
            this.settings.quickSwitchImageModels || [],
            this.settings.paletteTextModel || '',
            this.settings.paletteImageModel || '',
            this.settings.paletteNodeModel || '',
            this.settings.paletteEditModel || ''
        );

        // Set up model change callback for persisting selected models
        this.floatingPalette.setOnModelChange((mode, modelKey) => {
            if (mode === 'text') {
                this.settings.paletteTextModel = modelKey;
            } else if (mode === 'image') {
                this.settings.paletteImageModel = modelKey;
            } else if (mode === 'node') {
                this.settings.paletteNodeModel = modelKey;
            } else {
                this.settings.paletteEditModel = modelKey;
            }
            void this.saveSettings();
        });

        // Set version from manifest
        this.floatingPalette.setVersion(this.manifest.version);
    }

    /**
     * Handle generation with Ghost Node
     * Uses IntentResolver for intelligent intent parsing (design_doc_v2.md 3.2-3.6)
     */
    private async handleGeneration(userPrompt: string, mode: PaletteMode): Promise<void> {
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView);
        if (!canvasView || canvasView.getViewType() !== 'canvas') {
            console.error('Canvas Banana: Not in canvas view');
            return;
        }

        const canvas = (canvasView as CanvasView).canvas;
        if (!canvas) {
            console.error('Canvas Banana: Canvas not found');
            return;
        }

        const selection = canvas.selection;

        // Create local API manager for this task (concurrency-safe)
        const selectedModel = this.floatingPalette?.getSelectedModel(mode) || '';
        let localApiManager: ApiManager;

        if (selectedModel) {
            const [provider, modelId] = selectedModel.split('|');
            if (provider && modelId) {
                // Create a shallow copy of settings with overridden provider/model
                // Use type assertion to create the local settings object
                const localSettings: CanvasAISettings = {
                    ...this.settings,
                    apiProvider: provider as ApiProvider
                };

                // Override the model for the specific provider
                if (provider === 'openrouter') {
                    localSettings.openRouterTextModel = modelId;
                    localSettings.openRouterImageModel = modelId;
                } else if (provider === 'gemini') {
                    localSettings.geminiTextModel = modelId;
                    localSettings.geminiImageModel = modelId;
                } else if (provider === 'yunwu') {
                    localSettings.yunwuTextModel = modelId;
                    localSettings.yunwuImageModel = modelId;
                } else if (provider === 'gptgod') {
                    localSettings.gptGodTextModel = modelId;
                    localSettings.gptGodImageModel = modelId;
                }

                localApiManager = new ApiManager(localSettings);
                console.debug(`Canvas Banana: Quick switch to ${provider}/${modelId} (using local ApiManager)`);
            } else {
                // No valid quick switch model, use the default apiManager's settings
                localApiManager = new ApiManager(this.settings);
            }
        } else {
            // No quick switch model selected, use the default apiManager's settings
            localApiManager = new ApiManager(this.settings);
        }

        if (mode === 'edit') {
            const context = this.lastTextSelectionContext || this.captureTextSelectionContext(true);
            if (!context) {
                new Notice(t('No text selected'));
                return;
            }

            console.debug('Canvas Banana: Resolving edit intent for node', context.nodeId);

            let editIntent: NodeEditIntent;
            try {
                editIntent = await IntentResolver.resolveForNodeEdit(
                    this.app,
                    canvas,
                    context,
                    userPrompt,
                    this.settings
                );
            } catch (e) {
                console.error('Canvas Banana: Edit intent resolution failed:', e);
                return;
            }

            if (!editIntent.canEdit) {
                console.debug('Canvas Banana: Nothing to edit');
                return;
            }

            // Create Ghost Node relative to the edited node
            const node = canvas.nodes.get(context.nodeId);
            let nodeX = 100, nodeY = 100;
            if (node) {
                nodeX = node.x + node.width + 50;
                nodeY = node.y;
            }
            const ghostNode = this.ghostNodeManager!.createGhostNode(canvas, nodeX, nodeY);
            console.debug('Canvas Banana: Ghost Node created for edit result:', ghostNode.id);

            try {
                const editOptions = this.floatingPalette!.getEditOptions();
                
                // System Prompt for Editing - 固定格式指令 + 用户配置
                const systemPrompt = buildEditModeSystemPrompt(this.settings.editSystemPrompt);
                
                // Construct User Message with Context
                let userMsg = `Target Text:\n${editIntent.targetText}`;
                if (editIntent.upstreamContext) {
                    userMsg += `\n\nContext:\n${editIntent.upstreamContext}`;
                }
                userMsg += `\n\nInstruction:\n${editIntent.instruction}`;

                // Handle Upstream Images
                const mediaList = editIntent.images.map(img => ({
                    base64: img.base64,
                    mimeType: img.mimeType,
                    type: 'image' as const
                }));

                let response: string;
                if (mediaList.length > 0) {
                    const result = await localApiManager.multimodalChat(
                        userMsg,
                        mediaList,
                        systemPrompt,
                        editOptions.temperature
                    );
                    response = result.content;
                } else {
                    response = await localApiManager.chatCompletion(
                        userMsg,
                        systemPrompt,
                        editOptions.temperature
                    );
                }

                // Parse JSON response
                let replacementText = response;
                try {
                    const jsonMatch = response.match(/\{[\s\S]*\}/);
                    const jsonStr = jsonMatch ? jsonMatch[0] : response;
                    const parsed = JSON.parse(jsonStr);
                    if (parsed.replacement) {
                        replacementText = parsed.replacement;
                    }
                } catch (e) {
                    console.warn('Canvas Banana: Failed to parse edit JSON response, using raw text:', e);
                    replacementText = response.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
                }

                // Prepare Diff
                const originalNode = canvas.nodes.get(context.nodeId);
                
                // Robust check: Ensure node exists and has text property or setText ability
                // We relaxed the check here to ensure UI always appears
                if (originalNode) {
                    const proposedFullText = context.preText + replacementText + context.postText;

                    if (this.settings.debugMode) {
                        console.debug('Canvas Banana Debug: HandleGeneration Apply', {
                            context,
                            replacementText,
                            proposedFullText,
                            preTextLen: context.preText.length,
                            postTextLen: context.postText.length
                        });
                    }

                    // Update Ghost Node to show checks are done
                    this.ghostNodeManager!.updateGhostNode(ghostNode, "✅ Generated. Waiting for review...", false);

                    // Remove Ghost Node immediately to prevent it sticking around if modal is cancelled via Esc
                    canvas.removeNode(ghostNode);
                    canvas.requestSave();

                    // Show Diff Modal
                    new DiffModal(
                        this.app,
                        context,
                        replacementText,
                        async () => {
                            // On Confirm
                            if (context.fileNode) {
                                // File Node: write directly to the .md file
                                try {
                                    await this.app.vault.modify(context.fileNode, proposedFullText);
                                    new Notice(t('File updated'));
                                    if (this.settings.debugMode) {
                                        console.debug('Canvas Banana Debug: File Node updated:', context.fileNode.path);
                                    }
                                } catch (e) {
                                    console.error('Canvas Banana: Failed to write File Node:', e);
                                    new Notice(t('Failed to update file'));
                                }
                            } else if (originalNode.setText) {
                                originalNode.setText(proposedFullText);
                                canvas.requestSave();
                                new Notice(t('Text updated'));
                            } else {
                                // Fallback: Direct property assignment
                                // @ts-ignore
                                originalNode.text = proposedFullText;
                                // Try generic setData if available
                                // @ts-ignore
                                if (originalNode.setData) {
                                    // @ts-ignore
                                    originalNode.setData({ text: proposedFullText });
                                }
                                canvas.requestSave();
                                new Notice(t('Text updated'));
                            }
                        },
                        () => {
                            // On Cancel
                        }
                    ).open();

                } else {
                    // Fallback if node not found (should rarely happen as we just retrieved it)
                    this.ghostNodeManager!.updateGhostNode(ghostNode, replacementText, false);
                    console.warn('Canvas Banana: Original node not found for update, result left in Ghost Node');
                }

            } catch (error) {
                this.ghostNodeManager!.updateGhostNode(ghostNode, `Error: ${error instanceof Error ? error.message : String(error)}`, true);
            }
            return;
        }

        let intent: ResolvedIntent;
        try {
            intent = await IntentResolver.resolve(
                this.app,
                canvas,
                selection || new Set(),
                userPrompt,
                mode,
                this.settings
            );
        } catch (e) {
            console.error('Canvas Banana: Intent resolution failed:', e);
            return;
        }

        // Check if generation is possible
        if (!intent.canGenerate) {
            console.debug('Canvas Banana: Nothing to generate (no images, no text, no prompt)');
            return;
        }

        // Log warnings
        if (intent.warnings.length > 0) {
            console.warn('Canvas Banana: Warnings:', intent.warnings);
        }

        let nodeX = 100, nodeY = 100;
        if (selection && selection.size > 0) {
            const bbox = this.getSelectionBBox(selection);
            if (bbox) {
                nodeX = bbox.maxX + 50;
                nodeY = bbox.minY;
            }
        }

        // Create Ghost Node
        const ghostNode = this.ghostNodeManager!.createGhostNode(canvas, nodeX, nodeY);
        console.debug('Canvas Banana: Ghost Node created:', ghostNode.id);

        try {
            let response: string;

            if (mode === 'text') {
                // Text Mode (formerly Chat Mode) - use context and instruction
                let systemPrompt = this.settings.textSystemPrompt || 'You are a helpful AI assistant embedded in an Obsidian Canvas. Answer concisely and use Markdown formatting.';

                if (intent.contextText) {
                    systemPrompt += `\n\n---\nThe user has selected the following content from their canvas:\n\n${intent.contextText}\n\n---\nBased on this context, respond to the user's request.`;
                }

                // Get text options from palette
                const textOptions = this.floatingPalette!.getTextOptions();

                console.debug('Canvas Banana: Sending text request with context');

                // Build media list for multimodal request (images + PDFs)
                const mediaList: { base64: string, mimeType: string, type: 'image' | 'pdf' }[] = [];

                // Add images
                for (const img of intent.images) {
                    mediaList.push({
                        base64: img.base64,
                        mimeType: img.mimeType,
                        type: 'image'
                    });
                }

                // Add PDFs from nodes
                for (const node of intent.nodes) {
                    if (node.isPdf && node.pdfBase64) {
                        mediaList.push({
                            base64: node.pdfBase64,
                            mimeType: 'application/pdf',
                            type: 'pdf'
                        });
                    }
                }

                if (mediaList.length > 0) {
                    const result = await localApiManager.multimodalChat(
                        intent.instruction,
                        mediaList,
                        systemPrompt,
                        textOptions.temperature
                    );
                    response = result.content;
                } else {
                    response = await localApiManager.chatCompletion(intent.instruction, systemPrompt, textOptions.temperature);
                }
                console.debug('Canvas Banana: API Response received');
                this.ghostNodeManager!.updateGhostNode(ghostNode, response, false);

            } else if (mode === 'image') {
                // Image Mode - use new generateImageWithRoles
                // Get user-selected image options from palette
                const imageOptions = this.floatingPalette!.getImageOptions();
                console.debug('Canvas Banana: Sending image request with roles');
                console.debug('Canvas Banana: Instruction:', intent.instruction);
                console.debug('Canvas Banana: Images with roles:', intent.images.map(i => i.role));
                console.debug('Canvas Banana: Image options:', imageOptions);

                const base64Image = await localApiManager.generateImageWithRoles(
                    intent.instruction,
                    intent.images,
                    intent.contextText,
                    imageOptions.aspectRatio,
                    imageOptions.resolution
                );

                // Update Ghost Node to show saving status
                this.ghostNodeManager!.updateGhostNode(ghostNode, '💾 Saving image...', false, true);

                // Save to Vault
                const savedFile = await this.saveImageToVault(base64Image, intent.instruction);
                console.debug('Canvas Banana: Image saved to', savedFile.path);

                // Replace Ghost Node with Image Node
                this.ghostNodeManager!.replaceGhostWithImageNode(canvas, ghostNode, savedFile);

            } else {
                // Node Mode - Generate Canvas JSON structure
                const nodeOptions = this.floatingPalette!.getNodeOptions();
                console.debug('Canvas Banana: Sending node structure request');
                console.debug('Canvas Banana: Context text length:', intent.contextText.length);
                console.debug('Canvas Banana: Images count:', intent.images.length);

                // Build node mode system prompt
                const nodeSystemPrompt = this.getNodeModeSystemPrompt();

                let fullInstruction = intent.instruction;
                if (intent.contextText) {
                    // Use clear markers to separate context (content to process) from instruction (command)
                    // The instruction is a meta-command, should NOT appear in generated node content
                    fullInstruction = `[SOURCE_CONTENT]
${intent.contextText}
[/SOURCE_CONTENT]

[USER_INSTRUCTION]
${intent.instruction}
[/USER_INSTRUCTION]`;
                }

                // Build media list for multimodal request (images + PDFs) - same pattern as chat mode
                const mediaList: { base64: string, mimeType: string, type: 'image' | 'pdf' }[] = [];

                // Add images
                for (const img of intent.images) {
                    mediaList.push({
                        base64: img.base64,
                        mimeType: img.mimeType,
                        type: 'image'
                    });
                }

                // Add PDFs from nodes
                for (const node of intent.nodes) {
                    if (node.isPdf && node.pdfBase64) {
                        mediaList.push({
                            base64: node.pdfBase64,
                            mimeType: 'application/pdf',
                            type: 'pdf'
                        });
                    }
                }

                if (mediaList.length > 0) {
                    console.debug('Canvas Banana: Sending node request with', mediaList.length, 'media items');
                    const result = await localApiManager.multimodalChat(
                        fullInstruction,
                        mediaList,
                        nodeSystemPrompt,
                        nodeOptions.temperature
                    );
                    response = result.content;
                } else {
                    response = await localApiManager.chatCompletion(
                        fullInstruction,
                        nodeSystemPrompt,
                        nodeOptions.temperature
                    );
                }

                console.debug('Canvas Banana: Node structure response received');
                if (this.settings.debugMode) {
                    console.debug('Canvas Banana: Raw node response:', response);
                }

                try {
                    // Extract and parse JSON from response
                    let canvasData = extractCanvasJSON(response);

                    // Sanitize: remove empty nodes, orphan nodes, and invalid edges
                    const sanitizeResult = sanitizeCanvasData(canvasData, true);
                    canvasData = sanitizeResult.data;
                    if (sanitizeResult.stats.removedEmptyNodes > 0 || sanitizeResult.stats.removedOrphanNodes > 0 || sanitizeResult.stats.removedInvalidEdges > 0 || sanitizeResult.stats.fixedMalformedGroups > 0) {
                        console.debug(`Canvas Banana: Sanitized - removed ${sanitizeResult.stats.removedEmptyNodes} empty nodes, ${sanitizeResult.stats.removedOrphanNodes} orphan nodes, ${sanitizeResult.stats.removedInvalidEdges} invalid edges, fixed ${sanitizeResult.stats.fixedMalformedGroups} malformed groups`);
                    }

                    // Regenerate IDs to avoid collision with existing canvas elements
                    canvasData = regenerateIds(canvasData);

                    // Get ghost node center for coordinate remapping
                    const ghostCenter = {
                        x: ghostNode.x + ghostNode.width / 2,
                        y: ghostNode.y + ghostNode.height / 2
                    };
                    canvasData = remapCoordinates(canvasData, ghostCenter);

                    // Optimize layout: adjust sizes based on text and spread overlapping nodes
                    canvasData = optimizeLayout(canvasData);

                    // Replace ghost node with generated structure by modifying canvas file directly
                    await this.ghostNodeManager!.replaceGhostWithCanvasData(canvas, ghostNode, canvasData, this.settings.nodeDefaultColor);

                    console.debug(`Canvas Banana: Created ${canvasData.nodes.length} nodes and ${canvasData.edges.length} edges`);

                } catch (parseError: unknown) {
                    const message = parseError instanceof Error ? parseError.message : String(parseError);
                    console.error('Canvas Banana: JSON parse error:', parseError);
                    this.ghostNodeManager!.updateGhostNode(ghostNode, `❗ ${t('Invalid JSON structure')}: ${message}`, true);
                }
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('Canvas Banana: API Error:', message);
            this.ghostNodeManager!.updateGhostNode(ghostNode, `❗ Error: ${message || 'Unknown error'}`, true);
        } finally {
            // No restoration needed - we used a local ApiManager instance
            // This prevents race conditions when multiple tasks run concurrently
        }
    }

    private getNodeModeSystemPrompt(): string {
        return this.settings.nodeSystemPrompt?.trim() || DEFAULT_NODE_MODE_PROMPT;
    }

    /**
     * Save base64 image to vault
     * Detects MIME type from data URL and uses correct file extension
     */
    private async saveImageToVault(base64Data: string, _prompt: string): Promise<TFile> {
        // Extract MIME type and base64 data
        let mimeType = 'image/png';
        let base64 = base64Data;

        const dataUrlMatch = base64Data.match(/^data:(image\/\w+);base64,(.+)$/);
        if (dataUrlMatch) {
            mimeType = dataUrlMatch[1];
            base64 = dataUrlMatch[2];
        }

        // Determine file extension based on MIME type
        let extension = '.png';
        if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
            extension = '.jpg';
        } else if (mimeType === 'image/webp') {
            extension = '.webp';
        } else if (mimeType === 'image/gif') {
            extension = '.gif';
        }

        // Convert base64 to buffer
        const buffer = this.base64ToArrayBuffer(base64);

        // Generate simple timestamp-based filename (YYYYMMDDHHMMSS format)
        const now = new Date();
        const timestamp = now.getFullYear().toString() +
            String(now.getMonth() + 1).padStart(2, '0') +
            String(now.getDate()).padStart(2, '0') +
            String(now.getHours()).padStart(2, '0') +
            String(now.getMinutes()).padStart(2, '0') +
            String(now.getSeconds()).padStart(2, '0');
        const filename = `ai_image_${timestamp}${extension}`;

        // Check/Create "Canvas Images" folder in root
        const folderName = "Canvas Images";
        const existingFolder = this.app.vault.getAbstractFileByPath(folderName);
        if (!existingFolder) {
            try {
                await this.app.vault.createFolder(folderName);
            } catch (e: unknown) {
                if (!this.app.vault.getAbstractFileByPath(folderName)) {
                    const message = e instanceof Error ? e.message : String(e);
                    console.error('Canvas Banana: Failed to create folder:', e);
                    throw new Error(`Failed to create Canvas Images folder: ${message}`);
                }
            }
        }

        const filePath = `${folderName}/${filename}`;
        console.debug(`Canvas Banana: Saving image to ${filePath}, mimeType: ${mimeType}`);
        return await this.app.vault.createBinary(filePath, buffer);
    }

    /**
     * Helper: Base64 to ArrayBuffer
     */
    private base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    /**
     * Get selection bounding box (canvas coordinates)
     */
    private getSelectionBBox(selection: Set<CanvasNode>): CanvasCoords | null {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        let hasNode = false;

        selection.forEach(node => {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + node.width);
            maxY = Math.max(maxY, node.y + node.height);
            hasNode = true;
        });

        if (!hasNode) return null;
        return { minX, minY, maxX, maxY };
    }

    // Track last click target type for robust closing
    private lastClickWasBackground: boolean = false;
    private lastInteractionWasDeleteOrEsc: boolean = false;

    /**
     * 注册 Canvas 选中状态监听
     */
    /**
     * 注册 Canvas 选中状态监听
     */
    private registerCanvasSelectionListener(): void {
        // SCHEME B: Passive listeners removed for zero-overhead performance
        // Relying on 'captureMousedown' to update selection state on demand

        // 监听布局变化（包括选中状态变化）
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                this.checkCanvasSelection();
            })
        );

        // 关键修复：使用捕获阶段的 mousedown 拦截点击
        // 在浏览器清除文本选区之前捕获选区信息
        const captureMousedown = (evt: MouseEvent) => {
            // 鼠标操作时，重置键盘状态
            this.lastInteractionWasDeleteOrEsc = false;

            const target = evt.target as HTMLElement;
            
            // 检查是否点击了 AI Palette 相关元素
            const isPalette = target.closest('.canvas-ai-palette');
            const isAiButton = target.closest('#canvas-ai-sparkles');
            const isMenu = target.closest('.menu');

            if (isPalette || isAiButton || isMenu) {
                // 点击 AI 界面前，强制尝试捕获当前焦点所在的选区
                this.captureTextSelectionContext(true);
            } else {
                // User interacted with something else (canvas, node, background)
                // This marks a potential state change that should allow invalidating "stale" explicit context
                this.selectionInteractionFlag = true;
            }

            // 检查是否点击了 Canvas 及其 UI 元素 (用于背景点击检测)
            const isCanvasClick = target.closest('.canvas-wrapper');
            const isNode = target.closest('.canvas-node');
            const isEdge = target.closest('.canvas-edge');

            if (isCanvasClick) {
                if (!isNode && !isEdge && !isPalette && !isMenu) {
                    this.lastClickWasBackground = true;
                } else {
                    this.lastClickWasBackground = false;
                }
            } else {
                // Canvas 区域外点击，自为背景点击
                this.lastClickWasBackground = true;
            }
        };
        // 使用 capture: true 确保在冒泡阶段之前执行
        document.addEventListener('mousedown', captureMousedown, true);
        this.register(() => document.removeEventListener('mousedown', captureMousedown, true));

        // 监听 Escape 键
        const escapeHandler = (evt: KeyboardEvent) => {
            if (evt.key === 'Escape') {
                if (this.floatingPalette?.visible) {
                    this.floatingPalette.hide();
                    evt.preventDefault();
                    evt.stopPropagation();
                    evt.stopImmediatePropagation();
                }
            }
        };
        document.addEventListener('keydown', escapeHandler, true);
        this.register(() => document.removeEventListener('keydown', escapeHandler, true));

        // 监听键盘事件，用于捕获 Delete/Backspace
        this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
            if (evt.key === 'Delete' || evt.key === 'Backspace') {
                this.lastInteractionWasDeleteOrEsc = true;
                this.lastClickWasBackground = false;
            } else if (evt.key !== 'Escape') {
                this.lastInteractionWasDeleteOrEsc = false;
            }
        });

        // 监听活动叶子变化
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf) => {
                const currentView = this.app.workspace.getActiveViewOfType(ItemView);
                if (currentView?.getViewType() === 'canvas' && leaf?.view === currentView) {
                    return;
                }
                this.hideAllFloatingComponents();
            })
        );

        // 监听文件打开
        this.registerEvent(
            this.app.workspace.on('file-open', () => {
                const currentView = this.app.workspace.getActiveViewOfType(ItemView);
                if (currentView?.getViewType() !== 'canvas') {
                    this.hideAllFloatingComponents();
                }
            })
        );

        // 使用 requestAnimationFrame 轮询检查选中状态
        this.registerInterval(
            window.setInterval(() => {
                this.checkCanvasSelection();
            }, 200)
        );


    }





    /**
     * 捕获并解析文本选区上下文
     * @param updateCache 是否更新全局缓存
     * @param specificIframe 指定从特定 IFRAME 获取
     */
    private captureTextSelectionContext(updateCache: boolean = false, specificIframe?: HTMLIFrameElement): SelectionContext | null {
        let selection: Selection | null = null;
        let containerIframe: HTMLIFrameElement | null = specificIframe || null;

        // 1. 尝试从指定 IFRAME 获取
        if (specificIframe && specificIframe.contentDocument) {
            selection = specificIframe.contentDocument.getSelection();
        } 
        // 2. 尝试从 document.activeElement (如果是 IFRAME) 获取
        // Relaxed check: just check for IFRAME tag
        else if (document.activeElement?.tagName === 'IFRAME') {
            containerIframe = document.activeElement as HTMLIFrameElement;
            selection = containerIframe.contentDocument?.getSelection() || null;
        }
        // 3. 全局尝试（不常用，但在还没进入 iframe 时可能有效）
        else {
            selection = window.getSelection();
        }

        if (this.settings.debugMode) {
            console.debug('Canvas Banana Debug: captureTextSelectionContext strategy:', 
                specificIframe ? 'specificIframe' : (containerIframe ? 'activeElement' : 'window'),
                'Selection:', selection ? selection.toString() : 'null',
                'IsCollapsed:', selection?.isCollapsed,
                'CachedContext:', this.lastTextSelectionContext // Log the cache state
            );
        }

        // Check if we have a valid selection OR a valid fallback node
        let validNodeId: string | null = null;
        let validSelection: Selection | null = null;

        if (selection && !selection.isCollapsed && selection.toString().trim()) {
            validSelection = selection;
        }

        // 尝试确定 Node ID
        if (validSelection) {
            // Case A: User selected text
            if (containerIframe) {
                const nodeEl = containerIframe.closest('.canvas-node');
                validNodeId = nodeEl?.getAttribute('data-node-id') || null;
            } else if (validSelection.anchorNode) {
                const nodeEl = validSelection.anchorNode.parentElement?.closest('.canvas-node');
                validNodeId = nodeEl?.getAttribute('data-node-id') || null;
            }
        } 
        
        // Case B: No text selected (or failed to find ID), try fallback to single valid Text/File Node
        if (!validNodeId) {
            const canvas = this.getActiveCanvas();
            if (canvas && canvas.selection.size === 1) {
                const selectedNode = canvas.selection.values().next().value;
                // Text Node: has text property and no file/url/label
                if (selectedNode && selectedNode.text !== undefined && !selectedNode.file && !selectedNode.url && selectedNode.label === undefined) {
                    validNodeId = selectedNode.id;
                    if (this.settings.debugMode) {
                        console.debug('Canvas Banana Debug: Fallback to Text Node via implicit selection:', validNodeId);
                    }
                }
                // File Node (.md): has file property with .md extension
                else if (selectedNode && selectedNode.file?.extension === 'md') {
                    validNodeId = selectedNode.id;
                    if (this.settings.debugMode) {
                        console.debug('Canvas Banana Debug: Fallback to File Node (.md) via implicit selection:', validNodeId);
                    }
                }
            }
        }

        if (validNodeId) {
            const canvas = this.getActiveCanvas();
            const node = (canvas as Canvas)?.nodes.get(validNodeId);
            
            // Handle Text Node (has node.text)
            if (node && node.text) {
                let context: SelectionContext;

                if (validSelection) {
                    // Explicit text selection
                    const selectedText = validSelection.toString();
                    const fullText = node.text;
                    const index = fullText.indexOf(selectedText);
                    
                    if (index === -1) {
                         if (this.settings.debugMode) {
                            console.debug('Canvas Banana Debug: Selected text not found in node text (likely formatting mismatch)', selectedText);
                         }
                         return null;
                    }

                    context = {
                        nodeId: validNodeId,
                        selectedText,
                        preText: fullText.substring(0, index),
                        postText: fullText.substring(index + selectedText.length),
                        fullText,
                        isExplicit: true
                    };
                } else {
                    // Implicit full node selection
                    context = {
                        nodeId: validNodeId,
                        selectedText: node.text, // Whole text is selected
                        preText: '',
                        postText: '',
                        fullText: node.text,
                        isExplicit: false
                    };
                    if (this.settings.debugMode) {
                        console.debug('Canvas Banana Debug: Using implicit full node context');
                    }
                }

                if (this.settings.debugMode) {
                    console.debug('Canvas Banana Debug: Captured context:', context);
                }

                if (updateCache) {
                    // Prevent overwriting explicit selection with implicit fallback for the SAME node
                    // This handles the case where clicking the UI causes selection loss (fallback)
                    const isNewImplicit = context.isExplicit === false;
                    const isOldExplicit = this.lastTextSelectionContext?.isExplicit === true;
                    const isSameNode = this.lastTextSelectionContext?.nodeId === context.nodeId;

                    if (isNewImplicit && isOldExplicit && isSameNode && !this.selectionInteractionFlag) {
                        if (this.settings.debugMode) {
                            console.debug('Canvas Banana Debug: Ignoring implicit fallback update, keeping explicit context');
                        }
                    } else {
                        this.lastTextSelectionContext = context;
                        // Reset interaction flag after successful update
                        this.selectionInteractionFlag = false;
                    }
                }
                return context;
            }
            
            // Handle File Node (.md) - implicit full content selection only
            if (node && node.file?.extension === 'md') {
                // File Node: construct context with file reference
                // The actual content will be read asynchronously when needed
                const context: SelectionContext = {
                    nodeId: validNodeId,
                    selectedText: '', // Will be populated asynchronously
                    preText: '',
                    postText: '',
                    fullText: '',
                    isExplicit: false, // File Node always uses implicit full selection
                    fileNode: node.file
                };

                if (this.settings.debugMode) {
                    console.debug('Canvas Banana Debug: Captured File Node context:', context);
                }

                if (updateCache) {
                    this.lastTextSelectionContext = context;
                    this.selectionInteractionFlag = false;
                }
                return context;
            }
        }

        return null; 
    }

    /**
     * 检查 Canvas 选中状态
     */
    private checkCanvasSelection(): void {
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView);

        // 检查是否在 Canvas 视图
        if (!canvasView || canvasView.getViewType() !== 'canvas') {
            this.hideAllFloatingComponents();
            return;
        }

        // 获取 Canvas 实例 (使用 any 绕过类型检查)
        const canvas = (canvasView as CanvasView).canvas;
        if (!canvas) {
            this.hideAllFloatingComponents();
            return;
        }

        const selection = canvas.selection;
        const selectionSize = selection?.size ?? 0;
        const currentIds = new Set(Array.from(selection || []).map((n: CanvasNode) => n.id));

        // Use new active node strategy: dynamic listeners
        // SCHEME B: Active listener removed

        // 规则 3: 取消所有选中 -> 面板消失 
        // 改进：只有在明确点击背景或按下 Delete/Esc 时才关闭面板
        // 对于其他原因导致的 selectionSize === 0（如切换节点的过渡态），完全忽略
        if (selectionSize === 0) {
            const shouldCloseExplicitly = this.lastClickWasBackground || this.lastInteractionWasDeleteOrEsc;

            if (this.floatingPalette?.visible && !this.hideTimer && shouldCloseExplicitly) {
                // 明确的关闭意图：快速关闭
                this.hideTimer = window.setTimeout(() => {
                    // 二次确认：计时器结束时，如果真的还是 0 选中，才关闭
                    const currentSelection = (canvas).selection;
                    if (!currentSelection || currentSelection.size === 0) {
                        this.floatingPalette?.hide();
                        this.lastSelectedIds.clear();
                        this.lastSelectionSize = 0;
                    }
                    this.hideTimer = null;
                }, 50);
            }
            // 如果没有明确的关闭意图，完全不做任何事情，等待新的选中
            return;
        }

        // 有选中：立即取消正在进行的隐藏倒计时
        if (this.hideTimer) {
            window.clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }

        // 重置状态
        this.lastClickWasBackground = false;
        this.lastInteractionWasDeleteOrEsc = false;

        // 向原生工具条注入按钮
        this.injectAiButtonToPopupMenu(canvas);

        // 如果面板当前是显示状态，检查是否需要自动关闭或更新位置
        if (this.floatingPalette?.visible) {
            // 规则: 选中变化 -> 更新位置
            const screenBBox = this.getSelectionScreenBBox(selection);
            if (screenBBox) {
                const paletteX = screenBBox.right + 20;
                const paletteY = screenBBox.top;
                this.floatingPalette.updatePosition(paletteX, paletteY, canvas.wrapperEl);
            }
        }

        // 更新上下文预览
        if (this.floatingPalette?.visible) {
            const { imageCount, textCount, groupCount } = this.countNodeTypes(selection);
            this.floatingPalette.updateContextPreview(selectionSize, imageCount, textCount, groupCount);
            
            // Enable Edit tab ONLY for single Text Node
            // File Node (.md) editing is disabled due to lack of undo support
            const isSingleTextNode = selectionSize === 1 && textCount === 1 && imageCount === 0 && groupCount === 0;
            this.floatingPalette.setEditTabEnabled(isSingleTextNode);
        }

        // 更新状态记录
        this.updateStateRecord(selectionSize, currentIds);
    }

    /**
     * 更新状态记录
     */
    updateStateRecord(selectionSize: number, currentIds: Set<string>) {
        this.lastSelectionSize = selectionSize;
        this.lastSelectedIds = currentIds;
    }

    /**
     * 向 Canvas 原生 popup menu 注入 AI 按钮
     */
    private injectAiButtonToPopupMenu(canvas: Canvas): void {
        const menuEl = canvas.menu?.menuEl;
        if (!menuEl) return;

        // 如果已存在，不重复添加
        if (menuEl.querySelector(`#${AI_SPARKLES_BUTTON_ID}`)) return;

        // 创建 AI 按钮
        const aiButton = document.createElement('button');
        aiButton.id = AI_SPARKLES_BUTTON_ID;
        aiButton.classList.add('clickable-icon');
        setIcon(aiButton, 'banana');
        setTooltip(aiButton, 'CanvasBanana', { placement: 'top' });

        aiButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onSparklesButtonClick();
        });

        // 添加到工具条末尾
        menuEl.appendChild(aiButton);
    }

    /**
     * 获取选中节点的屏幕坐标包围盒
     * 使用节点 DOM 元素的 getBoundingClientRect 获取真实屏幕位置
     */
    private getSelectionScreenBBox(selection: Set<CanvasNode>): DOMRect | null {
        let left = Infinity, top = Infinity;
        let right = -Infinity, bottom = -Infinity;
        let hasValidNode = false;

        selection.forEach(node => {
            // 获取节点 DOM 元素的屏幕坐标
            const nodeEl = node.nodeEl;
            if (nodeEl) {
                const rect = nodeEl.getBoundingClientRect();
                left = Math.min(left, rect.left);
                top = Math.min(top, rect.top);
                right = Math.max(right, rect.right);
                bottom = Math.max(bottom, rect.bottom);
                hasValidNode = true;
            }
        });

        if (!hasValidNode) return null;

        return new DOMRect(left, top, right - left, bottom - top);
    }

    /**
     * 统计节点类型数量
     * 会展开 group 节点，统计其内部的子节点
     */
    private countNodeTypes(selection: Set<CanvasNode>): { imageCount: number; textCount: number; groupCount: number; mdFileCount: number } {
        let imageCount = 0;
        let textCount = 0;
        let groupCount = 0;
        let mdFileCount = 0;

        // Get canvas for expanding groups
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView);
        const canvas = canvasView?.getViewType() === 'canvas'
            ? (canvasView as CanvasView).canvas as Canvas | undefined
            : undefined;

        // Expand group nodes to include their children
        const expandedSelection = canvas
            ? CanvasConverter.expandGroupNodes(canvas, selection)
            : selection;

        expandedSelection.forEach(node => {
            if ((node as unknown as { label?: string }).label !== undefined) {
                // Group 节点（有 label 属性）
                groupCount++;
            } else if (node.file) {
                // 文件节点，检查是否为图片或 .md 文件
                const ext = node.file.extension?.toLowerCase();
                if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
                    imageCount++;
                } else if (ext === 'md') {
                    mdFileCount++;
                } else {
                    textCount++;
                }
            } else if (node.text !== undefined) {
                textCount++;
            } else if (node.url) {
                textCount++; // 链接节点算作文本
            }
        });

        return { imageCount, textCount, groupCount, mdFileCount };
    }

    /**
     * Sparkles 按钮点击处理
     */
    private onSparklesButtonClick(): void {
        if (!this.floatingPalette) return;

        if (this.floatingPalette.visible) {
            this.floatingPalette.hide();
        } else {
            // 获取当前 Canvas
            const canvasView = this.app.workspace.getActiveViewOfType(ItemView);
            if (!canvasView || canvasView.getViewType() !== 'canvas') return;

            const canvas = (canvasView as CanvasView).canvas;
            if (!canvas || canvas.selection.size === 0) return;

            // 尝试在打开面板前捕获选区 (Force capture)
            if (this.settings.debugMode) {
                console.debug('Canvas Banana Debug: Sparkles button clicked, attempting to capture text context');
            }
            this.captureTextSelectionContext(true);

            // 获取选中节点位置
            const screenBBox = this.getSelectionScreenBBox(canvas.selection);
            if (!screenBBox) return;

            // 面板位置：选中框右侧 (与 checkCanvasSelection 保持一致)
            const paletteX = screenBBox.right + 20;
            const paletteY = screenBBox.top;

            // 记录当前选中 ID，防止 checkCanvasSelection 误判为切换上下文而自动关闭
            this.lastSelectedIds = new Set(Array.from(canvas.selection).map(n => n.id));
            this.lastSelectionSize = canvas.selection.size;

            // 显示弹窗
            this.floatingPalette.show(paletteX, paletteY, canvas.wrapperEl, () => {
                // 关闭时的回调
            });

        }
    }

    /**
     * 隐藏所有悬浮组件
     */
    private hideAllFloatingComponents(): void {
        this.floatingPalette?.hide();
        this.lastSelectionSize = 0;
    }

    private registerCanvasUtilities(): void {
        // Double-click to open image in new window
        this.registerDomEvent(document, 'dblclick', async (evt: MouseEvent) => {
            const target = evt.target as HTMLElement;
            const nodeEl = target.closest('.canvas-node');
            if (!nodeEl) return;

            const canvas = this.getActiveCanvas();
            if (!canvas) return;

            const imageNode = this.getSelectedImageNode(canvas);
            if (imageNode?.file && this.settings.doubleClickImageOpen) {
                evt.preventDefault();
                evt.stopPropagation();
                await openImageInNewWindow(
                    this.app,
                    imageNode.file,
                    this.settings,
                    this.imagePopoutLeaf,
                    (leaf) => { this.imagePopoutLeaf = leaf; }
                );
            }
        });

        // Register Obsidian commands for hotkey integration
        this.addCommand({
            id: 'copy-image-to-clipboard',
            name: t('Copy Image to Clipboard'),
            checkCallback: (checking: boolean) => {
                const canvas = this.getActiveCanvas();
                const imageNode = this.getSelectedImageNode(canvas);
                if (imageNode?.file) {
                    if (!checking) {
                        void copyImageToClipboard(this.app, imageNode.file);
                    }
                    return true;
                }
                return false;
            }
        });

        this.addCommand({
            id: 'create-group-from-selection',
            name: t('Create Group'),
            checkCallback: (checking: boolean) => {
                const canvas = this.getActiveCanvas();
                if (canvas && canvas.selection.size > 0) {
                    if (!checking) {
                        createGroupFromSelection(canvas);
                    }
                    return true;
                }
                return false;
            }
        });

        this.addCommand({
            id: 'open-ai-palette',
            name: t('Open AI Palette'),
            checkCallback: (checking: boolean) => {
                // 优先检查 Canvas
                const canvas = this.getActiveCanvas();
                if (canvas && canvas.selection.size > 0) {
                    if (!checking) {
                        this.onSparklesButtonClick();
                    }
                    return true;
                }
                // 其次检查 Notes 编辑器
                if (this.notesHandler?.triggerOpenPalette) {
                    // checking 模式下，检查是否可以触发
                    if (checking) {
                        const view = this.app.workspace.getActiveViewOfType(ItemView);
                        if (view?.getViewType() === 'markdown') {
                            // 简单检查是否有选中文本
                            const mdView = view as unknown as { editor?: { getSelection?: () => string } };
                            const selection = mdView.editor?.getSelection?.();
                            return !!(selection && selection.trim().length > 0);
                        }
                        return false;
                    }
                    // 执行模式下，调用 triggerOpenPalette
                    return this.notesHandler.triggerOpenPalette();
                }
                return false;
            }
        });

        this.addCommand({
            id: 'create-new-node',
            name: t('Create New Node'),
            checkCallback: (checking: boolean) => {
                const canvas = this.getActiveCanvas();
                if (canvas) {
                    if (!checking) {
                        createNewNodeAtCenter(canvas);
                    }
                    return true;
                }
                return false;
            }
        });

        // 选择相连节点命令
        this.addCommand({
            id: 'select-connected-nodes',
            name: t('Select Connected Nodes'),
            checkCallback: (checking: boolean) => {
                const canvas = this.getActiveCanvas();
                if (canvas && canvas.selection.size > 0) {
                    if (!checking) {
                        selectConnectedNodes(canvas, false);
                    }
                    return true;
                }
                return false;
            }
        });

        // 选择子节点命令（只选择下游方向的节点）
        this.addCommand({
            id: 'select-child-nodes',
            name: t('Select Child Nodes'),
            checkCallback: (checking: boolean) => {
                const canvas = this.getActiveCanvas();
                if (canvas && canvas.selection.size > 0) {
                    if (!checking) {
                        selectConnectedNodes(canvas, true);
                    }
                    return true;
                }
                return false;
            }
        });

        // Register Canvas context menu items for node selection
        this.registerEvent(
            this.app.workspace.on('canvas:node-menu', (menu: Menu, _node: CanvasNode) => {
                const canvas = this.getActiveCanvas();
                if (!canvas) return;
                
                menu.addSeparator();
                menu.addItem((item: MenuItem) => {
                    item.setTitle(t('Select Connected Nodes'))
                        .setIcon('network')
                        .onClick(() => {
                            selectConnectedNodes(canvas, false);
                        });
                });
                menu.addItem((item: MenuItem) => {
                    item.setTitle(t('Select Child Nodes'))
                        .setIcon('arrow-down-right')
                        .onClick(() => {
                            selectConnectedNodes(canvas, true);
                        });
                });
            })
        );
    }

    /**
     * Get the active Canvas instance
     */
    private getActiveCanvas(): Canvas | null {
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView);
        if (!canvasView || canvasView.getViewType() !== 'canvas') return null;
        return (canvasView as CanvasView).canvas as Canvas | null;
    }

    /**
     * Check if current view is Canvas
     */
    private isCanvasViewActive(): boolean {
        const view = this.app.workspace.getActiveViewOfType(ItemView);
        return view?.getViewType() === 'canvas';
    }

    /**
     * Get the selected image node (only if single image selected)
     */
    private getSelectedImageNode(canvas: Canvas | null): CanvasNode | null {
        if (!canvas || canvas.selection.size !== 1) return null;
        const node = Array.from(canvas.selection)[0];
        if (!node.file) return null;
        const ext = node.file.extension?.toLowerCase();
        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
            return node;
        }
        return null;
    }

    /**
     * Match keyboard event against hotkey string (e.g., "Alt+C")
     */
    private matchesHotkey(evt: KeyboardEvent, hotkey: string): boolean {
        if (!hotkey) return false;
        const parts = hotkey.toLowerCase().split('+');
        const key = parts[parts.length - 1];
        const needCtrl = parts.includes('ctrl');
        const needShift = parts.includes('shift');
        const needAlt = parts.includes('alt');

        return evt.key.toLowerCase() === key &&
            evt.ctrlKey === needCtrl &&
            evt.shiftKey === needShift &&
            evt.altKey === needAlt;
    }




    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        // Update ApiManager settings reference
        this.apiManager?.updateSettings(this.settings);
        // 通知所有组件刷新配置
        this.notifySettingsChanged();
    }

    /**
     * 通知所有相关组件配置已变更
     */
    private notifySettingsChanged(): void {
        // 刷新 Canvas FloatingPalette
        this.floatingPalette?.refreshFromSettings(
            this.settings.chatPresets || [],
            this.settings.imagePresets || [],
            this.settings.nodePresets || [],
            this.settings.editPresets || [],
            this.settings.quickSwitchTextModels || [],
            this.settings.quickSwitchImageModels || [],
            this.settings.paletteTextModel || '',
            this.settings.paletteImageModel || '',
            this.settings.paletteNodeModel || '',
            this.settings.paletteEditModel || ''
        );

        // 刷新 Notes Handler
        this.notesHandler?.refreshFromSettings();

        // 刷新 Sidebar CoPilot View
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR_COPILOT);
        leaves.forEach(leaf => {
            const view = leaf.view as SideBarCoPilotView;
            view.refreshFromSettings?.();
        });
    }
}
