import 'dart:async';
import 'dart:io';
import 'package:http/http.dart' as http;

/// Retry wrapper for critical API calls.
/// Retries up to [maxAttempts] times with exponential backoff on network errors.
/// Only retries on connection/timeout errors — 4xx errors are returned immediately.
Future<http.Response> apiRetry(
  Future<http.Response> Function() fn, {
  int maxAttempts = 3,
  Duration baseDelay = const Duration(seconds: 1),
}) async {
  int attempt = 0;
  while (true) {
    try {
      attempt++;
      final res = await fn();
      // Don't retry on 4xx (client error) — only on 5xx or network failure
      if (res.statusCode >= 500 && attempt < maxAttempts) {
        await Future.delayed(baseDelay * attempt);
        continue;
      }
      return res;
    } on SocketException catch (_) {
      if (attempt >= maxAttempts) rethrow;
      await Future.delayed(baseDelay * attempt);
    } on TimeoutException catch (_) {
      if (attempt >= maxAttempts) rethrow;
      await Future.delayed(baseDelay * attempt);
    } on http.ClientException catch (_) {
      if (attempt >= maxAttempts) rethrow;
      await Future.delayed(baseDelay * attempt);
    }
  }
}
