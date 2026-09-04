@echo off
REM ---------------------------------------------------------------------
REM Nightly backup script for the Payment Tracking System database.
REM Scheduled via Task Scheduler (see SETUP_GUIDE.md Phase 7).
REM
REM BEFORE FIRST USE, edit the 4 values below to match your setup.
REM ---------------------------------------------------------------------

set PGPASSWORD=changeme
set PG_BIN="C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"
set DB_USER=ptsuser
set DB_NAME=payment_tracking

REM Local backup folder. Point this at a folder that OneDrive/Google Drive
REM is already syncing, so backups leave the server PC automatically.
set BACKUP_DIR=C:\PTS_Backups

REM Days to keep local backups before auto-deleting (rolling retention).
set RETENTION_DAYS=30

REM ---------------------------------------------------------------------
REM Nothing below this line needs editing.
REM ---------------------------------------------------------------------

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

REM Build a sortable timestamp: YYYYMMDD_HHMMSS
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set dt=%%I
set TIMESTAMP=%dt:~0,8%_%dt:~8,6%

set OUTFILE=%BACKUP_DIR%\payment_tracking_%TIMESTAMP%.dump

echo Backing up %DB_NAME% to %OUTFILE% ...
%PG_BIN% -U %DB_USER% -h localhost -d %DB_NAME% -F c -f "%OUTFILE%"

if %ERRORLEVEL% NEQ 0 (
  echo BACKUP FAILED - see error above.
  exit /b 1
)

echo Backup complete.

REM Delete backups older than RETENTION_DAYS.
forfiles /p "%BACKUP_DIR%" /s /m *.dump /D -%RETENTION_DAYS% /C "cmd /c del @path" 2>nul

echo Done.
