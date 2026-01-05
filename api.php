<?php
// Simple JSON API for SQLite persistence (PDO, no framework)
header('Content-Type: application/json; charset=utf-8');

const DEFAULT_CATEGORY_ID = 'all';
const UNCATEGORIZED_CATEGORY_ID = 'uncategorized';
const PRIVATE_CATEGORY_ID = 'private';
const TRASH_CATEGORY_ID = 'trash';
// runtime flag for optional column
$hasContentTypeColumn = false;

$dbFile = __DIR__ . DIRECTORY_SEPARATOR . 'note.db';

try {
    $pdo = new PDO('sqlite:' . $dbFile);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    // 假设数据库已预建表，无需在此自动建表/灌默认数据
    $pdo->exec('PRAGMA foreign_keys = ON;');
    $hasContentTypeColumn = ensureContentTypeColumn($pdo);
} catch (Throwable $e) {
    jsonResponse(false, null, '数据库连接失败: ' . $e->getMessage(), 500);
}

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $_GET['action'] ?? ($_POST['action'] ?? ($input['action'] ?? ''));

try {
    switch ($action) {
        case 'bootstrap':
            jsonResponse(true, fetchAll($pdo));
            break;
        case 'syncAll':
            syncAll($pdo, $input);
            jsonResponse(true, fetchAll($pdo));
            break;
        default:
            jsonResponse(false, null, 'Unknown action', 400);
    }
} catch (Throwable $e) {
    jsonResponse(false, null, $e->getMessage(), 500);
}

// ----- Helpers -----

function ensureContentTypeColumn(PDO $pdo): bool
{
    try {
        $hasColumn = false;
        $stmt = $pdo->query("PRAGMA table_info(notes);");
        foreach ($stmt as $col) {
            if (isset($col['name']) && $col['name'] === 'content_type') {
                $hasColumn = true;
                break;
            }
        }
        if (!$hasColumn) {
            $pdo->exec('ALTER TABLE notes ADD COLUMN content_type TEXT;');
            $hasColumn = true;
        }
        return $hasColumn;
    } catch (Throwable $e) {
        return false;
    }
}

function fetchAll(PDO $pdo): array
{
    global $hasContentTypeColumn;
    $cats = $pdo->query('SELECT id, name, is_system FROM categories')->fetchAll(PDO::FETCH_ASSOC) ?: [];
    try {
        $notes = $pdo->query('SELECT id, title, content, encrypted_json, category_id, is_private, is_deleted, original_category_id, updated_at, last_modified, content_type FROM notes')->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $hasContentTypeColumn = true;
    } catch (Throwable $e) {
        $notes = $pdo->query('SELECT id, title, content, encrypted_json, category_id, is_private, is_deleted, original_category_id, updated_at, last_modified FROM notes')->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $hasContentTypeColumn = false;
    }

    $notes = array_map(function (array $row) use ($hasContentTypeColumn) {
        return [
            'id' => $row['id'],
            'title' => $row['title'],
            'content' => $row['content'],
            'encrypted' => $row['encrypted_json'] ? json_decode($row['encrypted_json'], true) : null,
            'categoryId' => $row['category_id'],
            'isPrivate' => (bool) $row['is_private'],
            'isDeleted' => (bool) $row['is_deleted'],
            'originalCategoryId' => $row['original_category_id'],
            'updatedAt' => $row['updated_at'] ? (int) $row['updated_at'] : null,
            'lastModified' => $row['last_modified'],
            'contentType' => $hasContentTypeColumn ? ($row['content_type'] ?? 'plain') : 'plain',
        ];
    }, $notes);

    return [
        'categories' => array_map(static function (array $c) {
            return [
                'id' => $c['id'],
                'name' => $c['name'],
                'is_system' => (bool) $c['is_system'],
            ];
        }, $cats),
        'notes' => $notes,
    ];
}

function syncAll(PDO $pdo, array $payload): void
{
    global $hasContentTypeColumn;
    $categories = $payload['categories'] ?? [];
    $notes = $payload['notes'] ?? [];

    $pdo->beginTransaction();
    try {
        // 先删笔记再删分类，避免外键约束导致回滚
        $pdo->exec('DELETE FROM notes;');
        $pdo->exec('DELETE FROM categories;');

        $catStmt = $pdo->prepare('INSERT INTO categories(id, name, is_system) VALUES(:id, :name, :is_system)');
        foreach ($categories as $cat) {
            $catStmt->execute([
                ':id' => $cat['id'] ?? '',
                ':name' => $cat['name'] ?? '',
                ':is_system' => !empty($cat['is_system']) ? 1 : 0,
            ]);
        }

        if ($hasContentTypeColumn) {
            $noteStmt = $pdo->prepare(
                'INSERT INTO notes(id, title, content, encrypted_json, category_id, is_private, is_deleted, original_category_id, updated_at, last_modified, content_type)
                 VALUES(:id, :title, :content, :encrypted_json, :category_id, :is_private, :is_deleted, :original_category_id, :updated_at, :last_modified, :content_type)'
            );
        } else {
            $noteStmt = $pdo->prepare(
                'INSERT INTO notes(id, title, content, encrypted_json, category_id, is_private, is_deleted, original_category_id, updated_at, last_modified)
                 VALUES(:id, :title, :content, :encrypted_json, :category_id, :is_private, :is_deleted, :original_category_id, :updated_at, :last_modified)'
            );
        }

        foreach ($notes as $note) {
            $noteStmt->execute([
                ':id' => $note['id'] ?? '',
                ':title' => $note['title'] ?? null,
                ':content' => $note['content'] ?? null,
                ':encrypted_json' => isset($note['encrypted']) ? json_encode($note['encrypted'], JSON_UNESCAPED_UNICODE) : null,
                ':category_id' => $note['categoryId'] ?? UNCATEGORIZED_CATEGORY_ID,
                ':is_private' => !empty($note['isPrivate']) ? 1 : 0,
                ':is_deleted' => !empty($note['isDeleted']) ? 1 : 0,
                ':original_category_id' => $note['originalCategoryId'] ?? null,
                ':updated_at' => isset($note['updatedAt']) ? (int) $note['updatedAt'] : null,
                ':last_modified' => $note['lastModified'] ?? null,
                ...($hasContentTypeColumn ? [':content_type' => $note['contentType'] ?? 'plain'] : []),
            ]);
        }

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function jsonResponse(bool $success, $data = null, string $message = '', int $status = 200): void
{
    http_response_code($status);
    echo json_encode([
        'success' => $success,
        'data' => $data,
        'message' => $message,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}
