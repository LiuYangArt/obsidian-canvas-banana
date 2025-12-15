import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

if (!targetVersion) {
    console.error("Error: process.env.npm_package_version is not set. Please run this script via 'npm run'.");
    process.exit(1);
}

console.log(`Canvas Banana: Syncing version to ${targetVersion}...`);

// 1. Update manifest.json
try {
    const manifestPath = "manifest.json";
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.version !== targetVersion) {
        manifest.version = targetVersion;
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 4)); // 4 spaces indent
        console.log(`✅ Updated manifest.json to ${targetVersion}`);
    } else {
        console.log(`ℹ️ manifest.json is already up to date (${targetVersion})`);
    }

    // 2. Update versions.json
    const versionsPath = "versions.json";
    let versions = {};
    try {
        versions = JSON.parse(readFileSync(versionsPath, "utf8"));
    } catch (e) {
        // If versions.json doesn't exist or is invalid, start fresh
        console.log("ℹ️ versions.json not found or invalid, creating new.");
    }

    if (!versions[targetVersion]) {
        // Use minAppVersion from manifest for the mapping
        versions[targetVersion] = manifest.minAppVersion;
        writeFileSync(versionsPath, JSON.stringify(versions, null, 4));
        console.log(`✅ Added ${targetVersion} to versions.json`);
    } else {
        console.log(`ℹ️ versions.json already contains ${targetVersion}`);
    }

} catch (err) {
    console.error("❌ Error syncing versions:", err);
    process.exit(1);
}
