import 'dart:async';
import 'package:http/http.dart' as http;
import 'auth_service.dart';

typedef AuthenticatedRequest = Future<http.Response> Function(
  Map<String, String> headers,
);

class ApiClient {
  const ApiClient();

  Future<http.Response> get(
    String url, {
    Duration timeout = const Duration(seconds: 15),
  }) {
    return _request(
      (headers) => http.get(Uri.parse(url), headers: headers).timeout(timeout),
    );
  }

  Future<http.Response> post(
    String url, {
    Object? body,
    Duration timeout = const Duration(seconds: 15),
  }) {
    return _request(
      (headers) => http
          .post(Uri.parse(url), headers: headers, body: body)
          .timeout(timeout),
    );
  }

  Future<http.Response> patch(
    String url, {
    Object? body,
    Duration timeout = const Duration(seconds: 15),
  }) {
    return _request(
      (headers) => http
          .patch(Uri.parse(url), headers: headers, body: body)
          .timeout(timeout),
    );
  }

  Future<http.Response> _request(AuthenticatedRequest send) async {
    var headers = await AuthService.getHeaders();
    var response = await send(headers);

    if (response.statusCode == 401) {
      final refreshed = await AuthService.tryRefreshSession();
      if (refreshed) {
        headers = await AuthService.getHeaders();
        response = await send(headers);
      }

      if (response.statusCode == 401) {
        await AuthService.handle401(source: 'api_client');
      }
    }

    return response;
  }
}
