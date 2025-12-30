/**
 * Debug utilities for Canvas AI Plugin
 * These functions are only executed when debug mode is enabled
 */

import { App, ItemView } from 'obsidian';
import type { CanvasNode, CanvasView, SelectionContext } from '../types';
import { CanvasConverter } from '../canvas/canvas-converter';
import { IntentResolver } from '../canvas/intent-resolver';
import { PaletteMode } from '../ui/floating-palette';
import { CanvasAISettings } from '../settings/settings';

/**
 * Debug: Print detailed information about selected nodes
 * Used for testing and verification of node parsing
 */
export async function debugSelectedNodes(
    app: App,
    mode: PaletteMode,
    settings: CanvasAISettings,
    getPrompt: () => string,
    lastTextSelectionContext: SelectionContext | null
): Promise<void> {
    const canvasView = app.workspace.getActiveViewOfType(ItemView);

    if (!canvasView || canvasView.getViewType() !== 'canvas') {
        console.debug('Canvas Banana Debug: Not in Canvas view');
        return;
    }

    const canvas = (canvasView as CanvasView).canvas;
    if (!canvas) {
        console.debug('Canvas Banana Debug: Canvas not found');
        return;
    }

    const selection = canvas.selection;
    if (!selection || selection.size === 0) {
        console.debug('Canvas Banana Debug: No nodes selected');
        return;
    }

    console.debug('🔍 Canvas Banana Debug: Selected Nodes');
    console.debug('Current Mode:', mode);

    // Step 2.1: Print raw node data
    console.debug('📋 Raw Node Data');
    selection.forEach((node: CanvasNode) => {
        console.debug('---');
        console.debug('ID:', node.id);

        if (node.text !== undefined) {
            console.debug('Type: Text');
            console.debug('Content:', node.text);
        } else if (node.file) {
            console.debug('Type: File');
            console.debug('File Path:', node.file.path);
            console.debug('File Extension:', node.file.extension);
            console.debug('File Name:', node.file.name);
        } else if (node.url) {
            console.debug('Type: Link');
            console.debug('URL:', node.url);
        } else if (node.label !== undefined) {
            console.debug('Type: Group');
            console.debug('Label:', node.label);
        } else {
            console.debug('Type: Unknown');
            console.debug('Node Object:', node);
        }
    });

    // Step 2.2: Use CanvasConverter for format conversion (async)
    console.debug('📝 Converted Output');
    const result = await CanvasConverter.convert(app, canvas, selection);

    console.debug('Converted Nodes:', result.nodes);
    console.debug('Converted Edges:', result.edges);
    console.debug('\n--- Markdown Output ---\n');
    console.debug(result.markdown);
    console.debug('\n--- Mermaid Output ---\n');
    console.debug(result.mermaid);

    // IntentResolver parsing output
    console.debug(`🎨 IntentResolver Output (${mode} Mode Simulation)`);
    try {
        // Get prompt from palette (might be empty)
        const prompt = getPrompt();

        if (mode === 'edit') {
            const context = lastTextSelectionContext;
            if (!context) {
                console.debug('❌ No text selection context found for edit mode simulation');
                return;
            }
            
            const intent = await IntentResolver.resolveForNodeEdit(
                app,
                canvas,
                context,
                prompt,
                settings
            );

            console.debug('✅ canEdit:', intent.canEdit);
            console.debug('🎯 Target Text:', intent.targetText);
            console.debug('📝 Instruction:', intent.instruction);
            
            if (intent.upstreamContext) {
                console.debug('📄 Upstream Context:', intent.upstreamContext);
            }
            
            if (intent.images.length > 0) {
                console.debug('📷 Upstream Images with Roles');
                intent.images.forEach((img, idx) => {
                    console.debug(`[${idx + 1}] Role: "${img.role}", MimeType: ${img.mimeType}`);
                });
            }
            
            if (intent.warnings.length > 0) {
                console.debug('⚠️ Warnings');
                intent.warnings.forEach(w => console.warn(w));
            }
        } else {
            const intent = await IntentResolver.resolve(
                app,
                canvas,
                selection,
                prompt,
                mode,
                settings
            );

            console.debug('✅ canGenerate:', intent.canGenerate);

            if (intent.images.length > 0) {
                console.debug('📷 Images with Roles');
                intent.images.forEach((img, idx) => {
                    console.debug(`[${idx + 1}] Role: "${img.role}", MimeType: ${img.mimeType}, Base64 Length: ${img.base64.length}`);
                });
            } else {
                console.debug('(No images in selection)');
            }

            console.debug('📝 Instruction');
            console.debug('Final Instruction:', intent.instruction);

            console.debug('📄 Context Text');
            if (intent.contextText) {
                console.debug(intent.contextText);
            } else {
                console.debug('(No context text)');
            }

            if (intent.warnings.length > 0) {
                console.debug('⚠️ Warnings');
                intent.warnings.forEach(w => console.warn(w));
            }

            // Simulated Payload Structure
            console.debug('📦 Simulated API Payload Structure');

            let payloadPreview: Record<string, unknown> = {};

            if (mode === 'chat') {
                const systemPrompt = settings.chatSystemPrompt || 'You are a helpful AI assistant...';
                payloadPreview = {
                    model: settings.apiProvider === 'openrouter' ? settings.openRouterTextModel : (settings.apiProvider === 'yunwu' ? settings.yunwuTextModel : settings.geminiTextModel),
                    mode: 'chat',
                    systemPrompt: systemPrompt,
                    modalities: ['text'],
                    content_structure: [
                        { type: 'text', text: intent.instruction },
                        ...(intent.contextText ? [{ type: 'text', text: `[Context] ...` }] : []),
                        ...intent.images.map(img => ({ type: 'image_url', base64_length: img.base64.length }))
                    ]
                };
            } else if (mode === 'node') {
                const systemPrompt = settings.nodeSystemPrompt || 'Default Node Prompt...';
                payloadPreview = {
                    model: settings.apiProvider === 'openrouter' ? settings.openRouterTextModel : (settings.apiProvider === 'yunwu' ? settings.yunwuTextModel : settings.geminiTextModel),
                    mode: 'node',
                    systemPrompt: systemPrompt,
                    modalities: ['text'],
                    content_structure: [
                        { type: 'text', text: '[SOURCE_CONTENT]...' },
                        { type: 'text', text: '[TASK] ' + intent.instruction },
                        ...intent.images.map(img => ({ type: 'image_url', base64_length: img.base64.length }))
                    ]
                };
            } else {
                // Image Mode
                const systemPrompt = settings.imageSystemPrompt || 'Role: A Professional Image Creator...';
                payloadPreview = {
                    model: settings.apiProvider === 'openrouter' ? settings.openRouterImageModel : (settings.apiProvider === 'yunwu' ? settings.yunwuImageModel : settings.geminiImageModel),
                    mode: 'image',
                    systemPrompt: systemPrompt,
                    modalities: ['image', 'text'],
                    content_structure: [
                        ...intent.images.map(img => [
                            { type: 'text', text: `[Ref: ${img.role}]` },
                            { type: 'image_url', base64_length: img.base64.length }
                        ]).flat(),
                        intent.contextText ? { type: 'text', text: '[Context]...' } : null,
                        { type: 'text', text: `INSTRUCTION: ${intent.instruction.substring(0, 100)}${intent.instruction.length > 100 ? '...' : ''}` }
                    ].filter(Boolean)
                };
            }
            console.debug(JSON.stringify(payloadPreview, null, 2));
        }

    } catch (e) {
        console.error('IntentResolver failed:', e);
    }
}
