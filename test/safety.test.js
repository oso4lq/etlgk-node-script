import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFile, detectExecutableSignature } from '../lib/safety.js';

const verdict = (filename, contentType = null) => classifyFile({ filename, contentType }).verdict;

test('безопасные', () => {
  assert.equal(verdict('clip.mp4', 'video/mp4'), 'safe');
  assert.equal(verdict('ОТЧЁТ.PDF', 'application/octet-stream'), 'safe');
  assert.equal(verdict('archive.zip'), 'safe');
  assert.equal(verdict('download', 'video/mp4'), 'safe'); // нет расширения — решает MIME
});

test('исполняемые', () => {
  for (const ext of ['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'js', 'jar', 'sh', 'apk', 'dmg', 'pkg', 'deb', 'rpm', 'dll', 'lnk']) {
    assert.equal(verdict(`file.${ext}`), 'executable', ext);
  }
  assert.equal(verdict('photo.jpg.exe', 'image/jpeg'), 'executable');
  assert.equal(verdict('Setup.EXE'), 'executable');
  assert.equal(verdict('clip.mp4', 'application/x-msdownload'), 'executable'); // MIME сильнее расширения
});

test('неизвестные', () => {
  assert.equal(verdict('data.xyz', 'application/octet-stream'), 'unknown');
  assert.equal(verdict('index', 'text/html'), 'unknown');
  assert.equal(verdict('page.html', 'text/html'), 'unknown');
  assert.equal(verdict('pic.svg', 'image/svg+xml'), 'unknown'); // SVG может содержать скрипты
  assert.equal(verdict('file', null), 'unknown');
});

test('reason объясняет вердикт', () => {
  assert.match(classifyFile({ filename: 'a.exe', contentType: null }).reason, /\.exe/);
  assert.match(classifyFile({ filename: 'a.mp4', contentType: 'application/x-msdownload' }).reason, /application\/x-msdownload/);
});

test('сигнатуры', () => {
  assert.equal(detectExecutableSignature(Buffer.from('MZ\x90\x00')), 'Windows PE');
  assert.equal(detectExecutableSignature(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), 'ELF');
  assert.equal(detectExecutableSignature(Buffer.from([0xcf, 0xfa, 0xed, 0xfe])), 'Mach-O');
  assert.equal(detectExecutableSignature(Buffer.from('#!/bin/sh\n')), 'скрипт');
  assert.equal(detectExecutableSignature(Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])), null); // mp4
  assert.equal(detectExecutableSignature(Buffer.from('M')), null);
  assert.equal(detectExecutableSignature(Buffer.alloc(0)), null);
});

test('веб-страница под «безопасным» расширением — не безопасный файл', () => {
  assert.equal(verdict('video.mp4', 'text/html'), 'unknown');
  assert.equal(verdict('doc.pdf', 'application/xhtml+xml'), 'unknown');
  assert.match(classifyFile({ filename: 'video.mp4', contentType: 'text/html' }).reason, /веб-страниц/);
});

test('имя из одного расширения (".bat") считается исполняемым', () => {
  assert.equal(verdict('.bat', 'text/plain'), 'executable');
  assert.equal(verdict('.ps1', 'image/png'), 'executable');
  assert.equal(verdict('.gitignore', 'text/plain'), 'unknown');
});
