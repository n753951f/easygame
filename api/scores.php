<?php
/**
 * 排行榜 API
 *   GET  api/scores.php            → 取得前 10 名
 *   POST api/scores.php  (JSON)    → { name, score, coins, time } 新增一筆紀錄
 * 資料存放於 data/scores.json（不需 MySQL）
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const TOP_N    = 10;
const MAX_KEEP = 100;
const MAX_BODY = 2048;

$dataDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data';
$file    = $dataDir . DIRECTORY_SEPARATOR . 'scores.json';

function respond(int $code, array $body): void
{
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function read_scores($fp): array
{
    $raw  = stream_get_contents($fp);
    $data = json_decode($raw === false || $raw === '' ? '[]' : $raw, true);
    return is_array($data) ? $data : [];
}

function public_rows(array $scores): array
{
    return array_map(fn(array $s) => [
        'id'    => $s['id'] ?? '',
        'name'  => $s['name'] ?? 'Player',
        'score' => (int)($s['score'] ?? 0),
        'coins' => (int)($s['coins'] ?? 0),
        'time'  => (float)($s['time'] ?? 0),
        'date'  => $s['date'] ?? '',
    ], array_slice($scores, 0, TOP_N));
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    if (!is_file($file)) {
        respond(200, ['ok' => true, 'scores' => []]);
    }
    $fp = fopen($file, 'rb');
    if ($fp === false) {
        respond(500, ['ok' => false, 'error' => '無法讀取排行榜']);
    }
    flock($fp, LOCK_SH);
    $scores = read_scores($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    respond(200, ['ok' => true, 'scores' => public_rows($scores)]);
}

if ($method !== 'POST') {
    header('Allow: GET, POST');
    respond(405, ['ok' => false, 'error' => 'Method not allowed']);
}

// ---------- 驗證輸入 ----------
$body = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
if ($body === false || strlen($body) > MAX_BODY) {
    respond(413, ['ok' => false, 'error' => '資料過大']);
}
$input = json_decode($body, true);
if (!is_array($input)) {
    respond(400, ['ok' => false, 'error' => 'JSON 格式錯誤']);
}

$name = trim((string)($input['name'] ?? ''));
$name = preg_replace('/[\x00-\x1F\x7F<>"\'&]/u', '', $name) ?? '';
$name = function_exists('mb_substr') ? mb_substr($name, 0, 12, 'UTF-8') : substr($name, 0, 12);
if ($name === '') {
    $name = 'Player';
}

$score = filter_var($input['score'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 100000]]);
$coins = filter_var($input['coins'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 999]]);
$time  = filter_var($input['time'] ?? null, FILTER_VALIDATE_FLOAT);
if ($score === false || $coins === false || $time === false || $time < 1 || $time > 36000) {
    respond(400, ['ok' => false, 'error' => '分數資料不正確']);
}

// ---------- 寫入（檔案鎖避免同時寫入衝突） ----------
if (!is_dir($dataDir) && !mkdir($dataDir, 0775, true) && !is_dir($dataDir)) {
    respond(500, ['ok' => false, 'error' => '無法建立 data 資料夾']);
}
$fp = fopen($file, 'c+b');
if ($fp === false) {
    respond(500, ['ok' => false, 'error' => '無法寫入排行榜，請檢查 data 資料夾權限']);
}
flock($fp, LOCK_EX);
$scores = read_scores($fp);

$id = bin2hex(random_bytes(6));
$scores[] = [
    'id'    => $id,
    'name'  => $name,
    'score' => $score,
    'coins' => $coins,
    'time'  => round((float)$time, 2),
    'date'  => date('Y-m-d H:i'),
];
usort($scores, fn(array $a, array $b) => ($b['score'] <=> $a['score']) ?: ($a['time'] <=> $b['time']));
$scores = array_slice($scores, 0, MAX_KEEP);

ftruncate($fp, 0);
rewind($fp);
fwrite($fp, json_encode($scores, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

$rank = null;
foreach ($scores as $i => $s) {
    if ($s['id'] === $id) {
        $rank = $i + 1;
        break;
    }
}

respond(200, ['ok' => true, 'id' => $id, 'rank' => $rank, 'scores' => public_rows($scores)]);
