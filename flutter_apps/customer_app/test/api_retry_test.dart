import 'dart:async';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:jago_customer/services/api_retry.dart';

void main() {
  group('API Retry Edge Cases', () {
    test('Returns successfully on first try', () async {
      int calls = 0;
      final res = await apiRetry(() async {
        calls++;
        return http.Response('Success', 200);
      });

      expect(calls, 1);
      expect(res.statusCode, 200);
    });

    test('Retries on Server Error (500) and recovers', () async {
      int calls = 0;
      final res = await apiRetry(() async {
        calls++;
        if (calls == 1) {
          return http.Response('Server Error', 500);
        }
        return http.Response('Success on retry', 200);
      }, baseDelay: const Duration(milliseconds: 10));

      expect(calls, 2);
      expect(res.statusCode, 200);
    });

    test('Does not retry on Client Error (400)', () async {
      int calls = 0;
      final res = await apiRetry(() async {
        calls++;
        return http.Response('Bad Request', 400);
      }, baseDelay: const Duration(milliseconds: 10));

      expect(calls, 1);
      expect(res.statusCode, 400);
    });

    test('Retries and ultimately fails after maxAttempts for 500 status', () async {
      int calls = 0;
      final res = await apiRetry(() async {
        calls++;
        return http.Response('Server error continually', 500);
      }, maxAttempts: 3, baseDelay: const Duration(milliseconds: 10));

      expect(calls, 3);
      expect(res.statusCode, 500);
    });

    test('Retries up to maxAttempts on SocketException', () async {
      int calls = 0;
      try {
        await apiRetry(() async {
          calls++;
          throw const SocketException('No Internet');
        }, maxAttempts: 3, baseDelay: const Duration(milliseconds: 10));
        fail('Should have thrown SocketException');
      } catch (e) {
        expect(e, isA<SocketException>());
      }
      expect(calls, 3);
    });

    test('Recovers from TimeoutException', () async {
      int calls = 0;
      final res = await apiRetry(() async {
        calls++;
        if (calls < 3) throw TimeoutException('Timed out');
        return http.Response('Success later', 200);
      }, maxAttempts: 5, baseDelay: const Duration(milliseconds: 10));

      expect(calls, 3);
      expect(res.statusCode, 200);
    });
  });
}
