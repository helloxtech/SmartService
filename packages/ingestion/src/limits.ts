export const knowledgeLimits = {
    chunkOverlapTokens: 70,
    chunkTargetMaxTokens: 700,
    chunkTargetMinTokens: 350,
    extractedJsonBytes: 5_000_000,
    maxBatchStandardPages: 100,
    maxDocxStandardPages: 50,
    maxFileBytes: 20_000_000,
    maxPdfPages: 80,
    maxWebsiteDepth: 2,
    maxWebsitePages: 30,
    standardPageCjkCharacters: 800,
    standardPageEnglishWords: 500,
} as const;
