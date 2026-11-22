@echo off
rem a2_share · Windows 包装脚本（依次探测 py -3 / python3 / python）
setlocal
where py >nul 2>nul && (
  py -3 "%~dp0a2_share.py" %*
  exit /b %ERRORLEVEL%
)
where python3 >nul 2>nul && (
  python3 "%~dp0a2_share.py" %*
  exit /b %ERRORLEVEL%
)
where python >nul 2>nul && (
  python "%~dp0a2_share.py" %*
  exit /b %ERRORLEVEL%
)
echo [a2_share] 未找到 Python 3.11+。请安装 Python 并加入 PATH 后重试。
exit /b 2
