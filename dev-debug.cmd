@echo off
cd /d D:\AI\WorkOn\workonv0.2-6\workon
set ELECTRON_RUN_AS_NODE=
set ELECTRON_FORCE_RENDERER_ACCESSIBILITY=
npm run dev -- --remote-debugging-port=9222 > dev-out.log 2>&1
