/**
 * ws 模块的类型声明（仅声明模块存在，类型由动态导入处自行处理）。
 * 避免 host tsc 对 `import('ws')` 报 TS7016（无 @types/ws 时的标准做法）。
 */
declare module 'ws'
