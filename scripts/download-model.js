import { env, pipeline } from '@xenova/transformers';
import * as path from 'path';
import * as fs from 'fs';

// Enable remote downloading just for this initialization script
env.allowRemoteModels = true;
env.localModelPath = path.resolve('src/resources/models/');

async function main() {
    console.log('Downloading model all-MiniLM-L6-v2...');
    const modelDir = path.resolve('src/resources/models/all-MiniLM-L6-v2');
    if (!fs.existsSync(modelDir)) {
        fs.mkdirSync(modelDir, { recursive: true });
    }

    // This will download and cache/save the model files into localModelPath
    await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: true
    });

    console.log('Model downloaded successfully!');
    
    // List downloaded files to verify
    const files = fs.readdirSync(modelDir);
    console.log('Files in directory:', files);
}

main().catch(err => {
    console.error('Error downloading model:', err);
    process.exit(1);
});
