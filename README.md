# itda
ITDA는 Comfyui의 AI 영상 생성 워크플로우를 위한  Frame-Accurate Video Stitching Environment 입니다.

# ITDA MASTER SPEC v0.1

## Project Name

ITDA

### Meaning

ITDA (잇다) = Stitch

Connect Frames.
Connect Stories.

---

# Project Goal

ITDA는 일반 영상 편집기(Premiere, DaVinci, CapCut)가 아니다.

ITDA는 AI 영상 생성 워크플로우를 위한 Frame-Accurate Video Stitching Tool이다.

주요 사용 사례:

* LTX
* WAN
* Hunyuan
* SeedVR
* VFI
* ComfyUI Video Workflow

생성된 여러 개의 영상 클립을 오버랩 구간으로 연결하고 립싱크 및 오디오 싱크를 정확하게 맞춘 후 최종 영상으로 출력하는 것이 목적이다.

---

# Repository

ComfyUI-ITDA

TJ_NODE와 완전히 분리된 독립 프로젝트로 개발한다.

TJ_NODE는 Workflow Architecture Toolkit.

ITDA는 AI Video Stitching Environment.

---

# Core Design Philosophy

Frame Sync = Audio Sync = Timeline Sync

절대 깨지면 안 되는 원칙.

모든 편집은 Timecode 기반으로 동작한다.

영상 프레임과 오디오 위치는 항상 동일한 시간축 위에 존재해야 한다.

---

# Architecture

## Backend

ComfyUI

역할:

* 영상 디코딩
* 오디오 디코딩
* 썸네일 생성
* 웨이브폼 생성
* 프리렌더
* 최종 렌더
* ComfyUI 데이터 송수신

---

## Frontend

ITDA Web Editor

역할:

* Timeline
* Preview
* Clip Editing
* Audio Editing
* Project Management

---

# UI Layout

## Top Area

### Left

Media Bin

### Center

Preview

### Right

Clip Properties

---

## Bottom Area

Timeline

---

## Layout Ratio

기본값:

50 : 50

사용자가 드래그하여 조절 가능

예:

* Preview 크게
* Timeline 크게

---

# Media Bin

## Categories

* Video
* Audio
* Image
* Separated
* Generated
* Snapshot

---

## Import

지원 파일:

### Video

* mp4
* mov
* webm

### Audio

* wav
* mp3
* flac

### Image

* png
* jpg
* jpeg
* webp

---

# Project Folder Structure

```text
ComfyUI/
├─ input/
│
├─ ITDA/
│   ├─ media/
│   │   └─ project_name/
│   │       ├─ video/
│   │       ├─ audio/
│   │       ├─ image/
│   │       ├─ separated/
│   │       ├─ generated/
│   │       └─ snapshots/
│   │
│   ├─ cache/
│   │   └─ project_name/
│   │
│   └─ projects/
│       └─ project_name.itda.json
│
├─ ITDA-SNAPSHOT/
│
└─ output/
    └─ ITDA/
```

---

# Security Policy

허용 위치:

```text
input/ITDA/
output/ITDA/
```

외부 경로 접근 금지

차단:

```text
../
절대경로
```

파일명 Sanitizing 적용

---

# Project Management

## New Project

새 프로젝트 생성

---

## Open Project

프로젝트 불러오기

---

## Save Project

프로젝트 저장

확장자:

```text
.itda.json
```

---

## Save Project As

다른 이름 저장

---

## Duplicate Project

프로젝트 복제

---

## Delete Project

프로젝트 삭제

선택 가능:

* Project Only
* Project + Media
* Project + Media + Cache

---

# Timeline System

Clip-Based Timeline

Track-Based Timeline이 아니다.

Track은 단순 레인(Lane) 역할만 수행한다.

---

# Clip Structure

Clip

* Video
* Audio
* Thumbnail
* Waveform
* Metadata
* Timecode
* Trim
* Offset

---

# Clip Editing

## Move

클립 이동

---

## Split

현재 플레이헤드 기준 분할

---

## Merge

선택된 클립 병합

---

## Group

클립 그룹

---

## Ungroup

클립 그룹 해제

---

# Snap

기본값:

ON

---

## Snap ON

클립 끝점 자동 정렬

---

## Snap OFF

자유 이동

---

## Shortcut

S

---

# Clip Audio

## Audio Enabled

클립 단위 오디오 활성화

---

## Audio Disabled

클립 단위 오디오 비활성화

중요:

최종 Export에도 반영

---

## Volume

클립 단위 볼륨

---

## Audio Offset

오디오 위치 이동

---

## Audio Trim

* Trim In
* Trim Out

---

# Video / Audio Separation

## Detach Audio

비디오와 오디오 분리

---

생성:

* Video Clip
* Audio Clip

---

## Add To Media Bin

분리 결과를 Media Bin에 저장 가능

---

# Trim System

## Timeline Handle

좌우 핸들 드래그

---

## Numeric Input

Clip Properties에서 직접 입력

지원:

* Frame
* Time

---

# Playback

## Play

Space

---

## Frame Step

← → : 1 Frame

---

## Fast Step

Shift + ← →

---

## First / Last Frame

Alt + ← →

---

# Timeline Navigation

## Zoom

Mouse Wheel

---

## Horizontal Pan

Middle Mouse Drag

---

## Snap Ignore

Alt + Drag

---

# Range System

## Range Start

I

---

## Range End

O

---

## Clear Range

Alt + X

---

# Loop System

## Loop ON/OFF

선택 구간 반복

---

## Use Case

* Lip Sync
* Overlap Review
* Motion Continuity Check

---

# Pre-render

선택 Range만 캐시 생성

---

목적:

* 반복 재생 최적화
* 오디오 딜레이 제거
* 영상 딜레이 제거

---

# Preview

## Default

Single Preview

---

## Compare Mode

Dual Preview

---

## Overlay Mode

A+B Overlay

---

# Snapshot

## Export Current Frame

현재 프레임 저장

---

## Export To Input

경로:

```text
ComfyUI/input/ITDA-SNAPSHOT/
```

---

## Add Snapshot To Bin

Media Bin 등록 가능

---

# Export

## Render Video

최종 영상 파일 출력

---

지원:

* mp4
* mov
* webm

---

# Send To ComfyUI

출력:

* IMAGE Batch
* AUDIO
* FPS

---

워크플로우:

ITDA
→ ComfyUI
→ Upscale
→ VFI
→ Save Video

---

# Future Roadmap

## v0.3

* Timeline Core
* Clip Move
* Snap
* Auto Track
* Project Bin
* Properties

---

## v0.4

* Thumbnail
* Waveform
* Audio Detach
* Media Management

---

## v0.5

* Range
* Loop
* Pre-render
* Compare Preview

---

## v0.6

* Export
* Send To ComfyUI
* Snapshot
* Project Manager

---

# Final Definition

ITDA는 영상 편집기가 아니다.

ITDA는 AI 영상 생성 워크플로우를 위한

Frame-Accurate Video Stitching Environment

이다.
