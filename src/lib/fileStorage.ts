/**
 * fileStorage — 로컬 파일 저장소 유틸
 *
 * 역할:
 *   - 업로드 파일을 {projectRoot}/uploads/ 에 저장·조회·삭제
 *
 * TODO: 운영 환경에서는 Supabase Storage 또는 S3로 교체
 */

import fs from "fs";
import path from "path";

// 업로드 루트 디렉터리
const UPLOAD_ROOT = path.join(process.cwd(), "uploads");

/** 업로드 루트 디렉터리가 없으면 생성 */
export function ensureDir(subDir: string): string {
  const dir = path.join(UPLOAD_ROOT, subDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** 파일 저장 — Buffer를 subPath 경로에 기록 */
export function saveFile(subPath: string, buffer: Buffer): void {
  const fullPath = path.join(UPLOAD_ROOT, subPath);
  ensureDir(path.dirname(subPath));
  fs.writeFileSync(fullPath, buffer);
}

/** 파일 읽기 */
export function readFile(subPath: string): Buffer {
  return fs.readFileSync(path.join(UPLOAD_ROOT, subPath));
}

/** 파일 존재 여부 확인 */
export function fileExists(subPath: string): boolean {
  return fs.existsSync(path.join(UPLOAD_ROOT, subPath));
}

/** 파일 삭제 */
export function deleteFile(subPath: string): void {
  const fullPath = path.join(UPLOAD_ROOT, subPath);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}
