# 프로필 기본 이모지

이 폴더의 `*.webp` 그림은 **Microsoft Fluent Emoji**의 3D 스타일이에요.

- 원본: https://github.com/microsoft/fluentui-emoji (`assets/<이름>/3D/<이름>_3d.png`)
- 라이선스: MIT License — Copyright (c) Microsoft Corporation. 전문은 같은 폴더의 `LICENSE`
- 바꾼 점: 256px PNG → 160×160 WebP로 줄였어요 (`npm run emoji`).
- 고른 목록과 이름은 `shared/profile.ts`의 `EMOJI_CATEGORIES`.

라이선스 조건에 따라 그림을 배포할 때는 `LICENSE` 파일을 함께 둬요. 다른 이모지 세트의 그림은 섞지 않아요.
