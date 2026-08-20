import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:encrypt/encrypt.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// AES-256-CBC шифрование токенов подписок.
///
/// Ключ (256 бит) выводится через SHA-256 из секрета, который хранится в
/// защищённом хранилище ОС (Keychain / Android Keystore).
class AesCipher {
  AesCipher._();

  static const _storage = FlutterSecureStorage();
  static const _secretKey = 'nexus_secret';

  static Future<Uint8List> _keyBytes() async {
    final secret = await _secret();
    return Uint8List.fromList(sha256.convert(utf8.encode(secret)).bytes);
  }

  static Future<String> _secret() async {
    final existing = await _storage.read(key: _secretKey);
    if (existing != null && existing.isNotEmpty) return existing;
    final fresh = _randomId(48);
    await _storage.write(key: _secretKey, value: fresh);
    return fresh;
  }

  static Encrypter _encrypter(Uint8List key) =>
      Encrypter(AES(Key(key), mode: AESMode.cbc, padding: 'PKCS7'));

  /// Шифрует строку. Результат — base64(iv + ciphertext).
  static Future<String> encrypt(String plain) async {
    final key = await _keyBytes();
    final iv = IV.fromSecureRandom(16);
    final encrypted = _encrypter(key).encrypt(plain, iv: iv);
    return base64Encode(iv.bytes + encrypted.bytes);
  }

  static Future<String> decrypt(String encoded) async {
    final key = await _keyBytes();
    final all = base64Decode(encoded);
    final iv = IV(Uint8List.fromList(all.sublist(0, 16)));
    final body = Encrypted(Uint8List.fromList(all.sublist(16)));
    return _encrypter(key).decrypt(body, iv: iv);
  }

  static String _randomId(int length) {
    const chars =
        'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    final rand = Random.secure();
    return List.generate(length, (_) => chars[rand.nextInt(chars.length)]).join();
  }
}
