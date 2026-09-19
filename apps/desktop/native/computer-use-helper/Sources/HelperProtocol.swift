import Foundation

// MARK: - Protocol

struct HelperRequest: Decodable {
    let id: String
    let method: String
    let params: [String: AnyCodable]?
}

struct HelperErrorBody: Encodable {
    let code: String
    let message: String
}

struct HelperResponse: Encodable {
    let id: String
    let ok: Bool
    let result: AnyEncodable?
    let error: HelperErrorBody?

    static func success(id: String, result: Any) -> HelperResponse {
        HelperResponse(id: id, ok: true, result: AnyEncodable(result), error: nil)
    }

    static func failure(id: String, code: String, message: String) -> HelperResponse {
        HelperResponse(id: id, ok: false, result: nil, error: HelperErrorBody(code: code, message: message))
    }
}

/// Minimal type-erased JSON values for decoding/encoding dynamic params/results.
struct AnyCodable: Decodable {
    let value: Any

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { value = NSNull(); return }
        if let v = try? c.decode(Bool.self) { value = v; return }
        if let v = try? c.decode(Int.self) { value = v; return }
        if let v = try? c.decode(Double.self) { value = v; return }
        if let v = try? c.decode(String.self) { value = v; return }
        if let v = try? c.decode([String: AnyCodable].self) {
            value = v.mapValues { $0.value }
            return
        }
        if let v = try? c.decode([AnyCodable].self) {
            value = v.map { $0.value }
            return
        }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported JSON")
    }

    static func string(_ dict: [String: Any]?, _ key: String) -> String? {
        dict?[key] as? String
    }

    static func stringArray(_ dict: [String: Any]?, _ key: String) -> [String] {
        (dict?[key] as? [Any])?.compactMap { $0 as? String } ?? []
    }

    static func double(_ dict: [String: Any]?, _ key: String) -> Double? {
        if let d = dict?[key] as? Double { return d }
        if let i = dict?[key] as? Int { return Double(i) }
        return nil
    }

    static func int(_ dict: [String: Any]?, _ key: String) -> Int? {
        if let i = dict?[key] as? Int { return i }
        if let d = dict?[key] as? Double { return Int(d) }
        return nil
    }

    static func doubleArray(_ dict: [String: Any]?, _ key: String) -> [Double]? {
        guard let arr = dict?[key] as? [Any] else { return nil }
        return arr.compactMap {
            if let d = $0 as? Double { return d }
            if let i = $0 as? Int { return Double(i) }
            return nil
        }
    }
}

struct AnyEncodable: Encodable {
    let value: Any
    init(_ value: Any) { self.value = value }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case is NSNull:
            try c.encodeNil()
        case let v as Bool:
            try c.encode(v)
        case let v as Int:
            try c.encode(v)
        case let v as Double:
            try c.encode(v)
        case let v as String:
            try c.encode(v)
        case let v as [String: Any]:
            try c.encode(v.mapValues { AnyEncodable($0) })
        case let v as [Any]:
            try c.encode(v.map { AnyEncodable($0) })
        default:
            try c.encode(String(describing: value))
        }
    }
}
