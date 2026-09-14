export const maxAnalyzableFileBytes=2*1024*1024;
export function isOversized(size){return Number.isFinite(size)&&size>maxAnalyzableFileBytes;}
