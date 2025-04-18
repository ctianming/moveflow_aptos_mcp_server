#!/usr/bin/env node

// 导入服务器主模块
import '../build/index.js';

// CLI会直接运行build/index.js中的main函数
// 此文件主要用于提供npx执行入口点
// 添加shebang以确保它可以作为命令行工具运行
