"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JSONBindingsBuilder = exports.isEntry = void 0;
const as_1 = require("visitor-as/as");
const visitor_as_1 = require("visitor-as");
const NEAR_DECORATOR = "nearBindgen";
function returnsVoid(node) {
    return toString(node.signature.returnType) === "void";
}
function numOfParameters(node) {
    return node.signature.parameters.length;
}
function hasNearDecorator(stmt) {
    return ((stmt.text.includes("@nearfile") || stmt.text.includes("@" + NEAR_DECORATOR) || isEntry(stmt)) &&
        !stmt.text.includes("@notNearfile"));
}
function toString(node) {
    return visitor_as_1.ASTBuilder.build(node);
}
function isEntry(source) {
    return source.range.source.sourceKind == as_1.SourceKind.USER_ENTRY;
}
exports.isEntry = isEntry;
function isClass(type) {
    return type.kind == as_1.NodeKind.CLASSDECLARATION;
}
function isField(mem) {
    return mem.kind == as_1.NodeKind.FIELDDECLARATION;
}
function createDecodeStatements(_class) {
    return _class.members
        .filter(isField)
        .map((field) => {
        const name = toString(field.name);
        return (createDecodeStatement(field, `this.${name} = obj.has("${name}") ? `) +
            `: ${field.initializer != null ? toString(field.initializer) : `this.${name}`};`);
    });
}
function createDecodeStatement(field, setterPrefix = "") {
    let T = toString(field.type);
    let name = toString(field.name);
    return `${setterPrefix}decode<${T}, JSON.Obj>(obj, "${name}")`;
}
function createEncodeStatements(_class) {
    return _class.members
        .filter(isField)
        .map((field) => {
        let T = toString(field.type);
        let name = toString(field.name);
        return `encode<${T}, JSONEncoder>(this.${name}, "${name}", encoder);`;
    });
}
// TODO: Extract this into separate module, preferrable pluggable
class JSONBindingsBuilder extends visitor_as_1.BaseVisitor {
    constructor() {
        super(...arguments);
        this.sb = [];
        this.exportedClasses = new Map();
        this.wrappedFuncs = new Set();
    }
    static build(source) {
        return new JSONBindingsBuilder().build(source);
    }
    static nearFiles(parser) {
        return parser.sources.filter(hasNearDecorator);
    }
    visitClassDeclaration(node) {
        if (!this.exportedClasses.has(toString(node.name))) {
            this.exportedClasses.set(toString(node.name), node);
        }
        super.visitClassDeclaration(node);
    }
    visitFunctionDeclaration(node) {
        if (!isEntry(node) ||
            this.wrappedFuncs.has(toString(node.name)) ||
            !node.is(as_1.CommonFlags.EXPORT) ||
            (numOfParameters(node) == 0 && returnsVoid(node))) {
            super.visitFunctionDeclaration(node);
            return;
        }
        this.generateWrapperFunction(node);
        // Change function to not be an export
        node.flags = node.flags ^ as_1.CommonFlags.EXPORT;
        this.wrappedFuncs.add(toString(node.name));
        super.visit(node);
    }
    /*
    Create a wrapper function that will be export in the function's place.
    */
    generateWrapperFunction(func) {
        let signature = func.signature;
        let params = signature.parameters;
        let returnType = signature.returnType;
        let returnTypeName = toString(returnType)
            .split("|")
            .map(name => name.trim())
            .filter(name => name !== "null")
            .join("|");
        let hasNull = toString(returnType).includes("null");
        let name = func.name.text;
        this.sb.push(`function __wrapper_${name}(): void {`);
        if (params.length > 0) {
            this.sb.push(`  const obj = getInput();`);
        }
        if (toString(returnType) !== "void") {
            this.sb.push(`  let result: ${toString(returnType)} = ${name}(`);
        }
        else {
            this.sb.push(`  ${name}(`);
        }
        if (params.length > 0) {
            this.sb[this.sb.length - 1] += params
                .map(param => createDecodeStatement(param))
                .join(", ");
        }
        this.sb[this.sb.length - 1] += ");";
        if (toString(returnType) !== "void") {
            this.sb.push(`  const val = encode<${returnTypeName}>(${hasNull ? `changetype<${returnTypeName}>(result)` : "result"});
  value_return(val.byteLength, val.dataStart);`);
        }
        this.sb.push(`}
export { __wrapper_${name} as ${name} }`);
    }
    typeName(type) {
        if (!isClass(type)) {
            return toString(type);
        }
        type = type;
        let className = toString(type.name);
        if (type.isGeneric) {
            className += "<" + type.typeParameters.map(toString).join(", ") + ">";
        }
        return className;
    }
    build(source) {
        const isNearFile = source.text.includes("@nearfile");
        this.sb = [];
        this.visit(source);
        let sourceText = source.statements.map(stmt => {
            let str = toString(stmt);
            if (isClass(stmt) &&
                (visitor_as_1.utils.hasDecorator(stmt, NEAR_DECORATOR) || isNearFile)) {
                let _class = stmt;
                str = str.slice(0, str.lastIndexOf("}"));
                let fields = _class.members
                    .filter(isField)
                    .map((field) => field);
                if (fields.some((field) => field.type == null)) {
                    throw new Error("All Fields must have explict type declaration.");
                }
                let className = this.typeName(_class);
                if (!visitor_as_1.utils.hasDecorator(stmt, NEAR_DECORATOR)) {
                    console.error("\x1b[31m", `@nearfile is deprecated use @${NEAR_DECORATOR} decorator on ${className}`, "\x1b[0m");
                }
                str += `
  decode<_V = Uint8Array>(buf: _V): ${className} {
    let json: JSON.Obj;
    if (buf instanceof Uint8Array) {
      json = JSON.parse(buf);
    } else {
      assert(buf instanceof JSON.Obj, "argument must be Uint8Array or Json Object");
      json = <JSON.Obj> buf;
    }
    return this._decode(json);
  }

  static decode(buf: Uint8Array): ${className} {
    return decode<${className}>(buf);
  }

  private _decode(obj: JSON.Obj): ${className} {
    ${createDecodeStatements(_class).join("\n    ")}
    return this;
  }

  _encode(name: string | null = "", _encoder: JSONEncoder | null = null): JSONEncoder {
    let encoder = _encoder == null ? new JSONEncoder() : _encoder;
    encoder.pushObject(name);
    ${createEncodeStatements(_class).join("\n    ")}
    encoder.popObject();
    return encoder;
  }
  encode(): Uint8Array {
    return this._encode().serialize();
  }

  serialize(): Uint8Array {
    return this.encode();
  }

  toJSON(): string {
    return this._encode().toString();
  }
}`;
            }
            return str;
        });
        return sourceText.concat(this.sb).join("\n");
    }
}
exports.JSONBindingsBuilder = JSONBindingsBuilder;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiSlNPTkJ1aWxkZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvSlNPTkJ1aWxkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsc0NBYXVCO0FBQ3ZCLDJDQUEyRDtBQUczRCxNQUFNLGNBQWMsR0FBRyxhQUFhLENBQUE7QUFFcEMsU0FBUyxXQUFXLENBQUMsSUFBeUI7SUFDNUMsT0FBTyxRQUFRLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsS0FBSyxNQUFNLENBQUM7QUFDeEQsQ0FBQztBQUVELFNBQVMsZUFBZSxDQUFDLElBQXlCO0lBQ2hELE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDO0FBQzFDLENBQUM7QUFFRCxTQUFTLGdCQUFnQixDQUFDLElBQVk7SUFDcEMsT0FBTyxDQUNMLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxHQUFHLGNBQWMsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUM5RixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxDQUNwQyxDQUFDO0FBQ0osQ0FBQztBQUVELFNBQVMsUUFBUSxDQUFDLElBQVU7SUFDMUIsT0FBTyx1QkFBVSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUNoQyxDQUFDO0FBRUQsU0FBZ0IsT0FBTyxDQUFDLE1BQXFCO0lBQzNDLE9BQU8sTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsVUFBVSxJQUFJLGVBQVUsQ0FBQyxVQUFVLENBQUM7QUFDakUsQ0FBQztBQUZELDBCQUVDO0FBRUQsU0FBUyxPQUFPLENBQUMsSUFBVTtJQUN6QixPQUFPLElBQUksQ0FBQyxJQUFJLElBQUksYUFBUSxDQUFDLGdCQUFnQixDQUFDO0FBQ2hELENBQUM7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RyxNQUFNLENBQUMsT0FBTztxQkFDeEIsTUFBTSxDQUFDLE9BQU8sQ0FBQztxQkFDZixHQUFHLENBQUMsQ0FBQyxLQUF1QixFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFDM0MsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQyxFQUFFO29CQUM5QyxNQUFNLElBQUksS0FBSyxDQUFDLGdEQUFnRCxDQUFDLENBQUM7aUJBQ25FO2dCQUNELElBQUksU0FBUyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUM7Z0JBQ3RDLElBQUksQ0FBQyxrQkFBSyxDQUFDLFlBQVksQ0FBbUIsSUFBSSxFQUFFLGNBQWMsQ0FBQyxFQUFFO29CQUMvRCxPQUFPLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRSxnQ0FBZ0MsY0FBYyxpQkFBaUIsU0FBUyxFQUFFLEVBQUMsU0FBUyxDQUFDLENBQUM7aUJBQ2pIO2dCQUNELEdBQUcsSUFBSTtzQ0FDdUIsU0FBUzs7Ozs7Ozs7Ozs7b0NBV1gsU0FBUztvQkFDekIsU0FBUzs7O29DQUdPLFNBQVM7TUFDdkMsc0JBQXNCLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQzs7Ozs7OztNQU83QyxzQkFBc0IsQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDOzs7Ozs7Ozs7Ozs7Ozs7RUFlakQsQ0FBQzthQUNJO1lBQ0QsT0FBTyxHQUFHLENBQUM7UUFDYixDQUFDLENBQUMsQ0FBQztRQUNILE9BQU8sVUFBVSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQy9DLENBQUM7Q0FDRjtBQTFKRCxrREEwSkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1xuICBOb2RlLFxuICBGdW5jdGlvbkRlY2xhcmF0aW9uLFxuICBOb2RlS2luZCxcbiAgU291cmNlLFxuICBTb3VyY2VLaW5kLFxuICBUeXBlTm9kZSxcbiAgQ2xhc3NEZWNsYXJhdGlvbixcbiAgRGVjbGFyYXRpb25TdGF0ZW1lbnQsXG4gIFBhcnNlcixcbiAgQ29tbW9uRmxhZ3MsXG4gIEZpZWxkRGVjbGFyYXRpb24sXG4gIFBhcmFtZXRlck5vZGUsXG59IGZyb20gXCJ2aXNpdG9yLWFzL2FzXCI7XG5pbXBvcnQgeyBBU1RCdWlsZGVyLCBCYXNlVmlzaXRvciwgdXRpbHN9IGZyb20gXCJ2aXNpdG9yLWFzXCI7XG5cblxuY29uc3QgTkVBUl9ERUNPUkFUT1IgPSBcIm5lYXJCaW5kZ2VuXCJcblxuZnVuY3Rpb24gcmV0dXJuc1ZvaWQobm9kZTogRnVuY3Rpb25EZWNsYXJhdGlvbik6IGJvb2xlYW4ge1xuICByZXR1cm4gdG9TdHJpbmcobm9kZS5zaWduYXR1cmUucmV0dXJuVHlwZSkgPT09IFwidm9pZFwiO1xufVxuXG5mdW5jdGlvbiBudW1PZlBhcmFtZXRlcnMobm9kZTogRnVuY3Rpb25EZWNsYXJhdGlvbik6IG51bWJlciB7XG4gIHJldHVybiBub2RlLnNpZ25hdHVyZS5wYXJhbWV0ZXJzLmxlbmd0aDtcbn1cblxuZnVuY3Rpb24gaGFzTmVhckRlY29yYXRvcihzdG10OiBTb3VyY2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIChcbiAgICAoc3RtdC50ZXh0LmluY2x1ZGVzKFwiQG5lYXJmaWxlXCIpIHx8IHN0bXQudGV4dC5pbmNsdWRlcyhcIkBcIiArIE5FQVJfREVDT1JBVE9SKSB8fCBpc0VudHJ5KHN0bXQpKSAmJlxuICAgICFzdG10LnRleHQuaW5jbHVkZXMoXCJAbm90TmVhcmZpbGVcIilcbiAgKTtcbn1cblxuZnVuY3Rpb24gdG9TdHJpbmcobm9kZTogTm9kZSk6IHN0cmluZyB7XG4gIHJldHVybiBBU1RCdWlsZGVyLmJ1aWxkKG5vZGUpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNFbnRyeShzb3VyY2U6IFNvdXJjZSB8IE5vZGUpOiBib29sZWFuIHtcbiAgcmV0dXJuIHNvdXJjZS5yYW5nZS5zb3VyY2Uuc291cmNlS2luZCA9PSBTb3VyY2VLaW5kLlVTRVJfRU5UUlk7XG59XG5cbmZ1bmN0aW9uIGlzQ2xhc3ModHlwZTogTm9kZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gdHlwZS5raW5kID09IE5vZGVLaW5kLkNMQVNTREVDTEFSQVRJT047XG59XG5cbmZ1bmN0aW9uIGlzRmllbGQobWVtOiBEZWNsYXJhdGlvblN0YXRlbWVudCkge1xuICByZXR1cm4gbWVtLmtpbmQgPT0gTm9kZUtpbmQuRklFTERERUNMQVJBVElPTjtcbn1cblxuZnVuY3Rpb24gY3JlYXRlRGVjb2RlU3RhdGVtZW50cyhfY2xhc3M6IENsYXNzRGVjbGFyYXRpb24pOiBzdHJpbmdbXSB7XG4gIHJldHVybiBfY2xhc3MubWVtYmVyc1xuICAgIC5maWx0ZXIoaXNGaWVsZClcbiAgICAubWFwKChmaWVsZDogRmllbGREZWNsYXJhdGlvbik6IHN0cmluZyA9PiB7XG4gICAgICBjb25zdCBuYW1lID0gdG9TdHJpbmcoZmllbGQubmFtZSk7XG4gICAgICByZXR1cm4gKFxuICAgICAgICBjcmVhdGVEZWNvZGVTdGF0ZW1lbnQoZmllbGQsIGB0aGlzLiR7bmFtZX0gPSBvYmouaGFzKFwiJHtuYW1lfVwiKSA/IGApICtcbiAgICAgICAgYDogJHtmaWVsZC5pbml0aWFsaXplciAhPSBudWxsID8gdG9TdHJpbmcoZmllbGQuaW5pdGlhbGl6ZXIpIDogYHRoaXMuJHtuYW1lfWB9O2BcbiAgICAgICk7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZURlY29kZVN0YXRlbWVudChcbiAgZmllbGQ6IEZpZWxkRGVjbGFyYXRpb24gfCBQYXJhbWV0ZXJOb2RlLFxuICBzZXR0ZXJQcmVmaXg6IHN0cmluZyA9IFwiXCJcbik6IHN0cmluZyB7XG4gIGxldCBUID0gdG9TdHJpbmcoZmllbGQudHlwZSEpO1xuICBsZXQgbmFtZSA9IHRvU3RyaW5nKGZpZWxkLm5hbWUpO1xuICByZXR1cm4gYCR7c2V0dGVyUHJlZml4fWRlY29kZTwke1R9LCBKU09OLk9iaj4ob2JqLCBcIiR7bmFtZX1cIilgO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVFbmNvZGVTdGF0ZW1lbnRzKF9jbGFzczogQ2xhc3NEZWNsYXJhdGlvbik6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIF9jbGFzcy5tZW1iZXJzXG4gICAgLmZpbHRlcihpc0ZpZWxkKVxuICAgIC5tYXAoKGZpZWxkOiBGaWVsZERlY2xhcmF0aW9uKTogc3RyaW5nID0+IHtcbiAgICAgIGxldCBUID0gdG9TdHJpbmcoZmllbGQudHlwZSEpO1xuICAgICAgbGV0IG5hbWUgPSB0b1N0cmluZyhmaWVsZC5uYW1lKTtcbiAgICAgIHJldHVybiBgZW5jb2RlPCR7VH0sIEpTT05FbmNvZGVyPih0aGlzLiR7bmFtZX0sIFwiJHtuYW1lfVwiLCBlbmNvZGVyKTtgO1xuICAgIH0pO1xufVxuXG4vLyBUT0RPOiBFeHRyYWN0IHRoaXMgaW50byBzZXBhcmF0ZSBtb2R1bGUsIHByZWZlcnJhYmxlIHBsdWdnYWJsZVxuZXhwb3J0IGNsYXNzIEpTT05CaW5kaW5nc0J1aWxkZXIgZXh0ZW5kcyBCYXNlVmlzaXRvciB7XG4gIHByaXZhdGUgc2I6IHN0cmluZ1tdID0gW107XG4gIHByaXZhdGUgZXhwb3J0ZWRDbGFzc2VzOiBNYXA8c3RyaW5nLCBDbGFzc0RlY2xhcmF0aW9uPiA9IG5ldyBNYXAoKTtcbiAgd3JhcHBlZEZ1bmNzOiBTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoKTtcblxuICBzdGF0aWMgYnVpbGQoc291cmNlOiBTb3VyY2UpOiBzdHJpbmcge1xuICAgIHJldHVybiBuZXcgSlNPTkJpbmRpbmdzQnVpbGRlcigpLmJ1aWxkKHNvdXJjZSk7XG4gIH1cblxuICBzdGF0aWMgbmVhckZpbGVzKHBhcnNlcjogUGFyc2VyKTogU291cmNlW10ge1xuICAgIHJldHVybiBwYXJzZXIuc291cmNlcy5maWx0ZXIoaGFzTmVhckRlY29yYXRvcik7XG4gIH1cblxuICB2aXNpdENsYXNzRGVjbGFyYXRpb24obm9kZTogQ2xhc3NEZWNsYXJhdGlvbik6IHZvaWQge1xuICAgIGlmICghdGhpcy5leHBvcnRlZENsYXNzZXMuaGFzKHRvU3RyaW5nKG5vZGUubmFtZSkpKSB7XG4gICAgICB0aGlzLmV4cG9ydGVkQ2xhc3Nlcy5zZXQodG9TdHJpbmcobm9kZS5uYW1lKSwgbm9kZSk7XG4gICAgfVxuICAgIHN1cGVyLnZpc2l0Q2xhc3NEZWNsYXJhdGlvbihub2RlKTtcbiAgfVxuXG4gIHZpc2l0RnVuY3Rpb25EZWNsYXJhdGlvbihub2RlOiBGdW5jdGlvbkRlY2xhcmF0aW9uKTogdm9pZCB7XG4gICAgaWYgKFxuICAgICAgIWlzRW50cnkobm9kZSkgfHxcbiAgICAgIHRoaXMud3JhcHBlZEZ1bmNzLmhhcyh0b1N0cmluZyhub2RlLm5hbWUpKSB8fFxuICAgICAgIW5vZGUuaXMoQ29tbW9uRmxhZ3MuRVhQT1JUKSB8fFxuICAgICAgKG51bU9mUGFyYW1ldGVycyhub2RlKSA9PSAwICYmIHJldHVybnNWb2lkKG5vZGUpKVxuICAgICkge1xuICAgICAgc3VwZXIudmlzaXRGdW5jdGlvbkRlY2xhcmF0aW9uKG5vZGUpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmdlbmVyYXRlV3JhcHBlckZ1bmN0aW9uKG5vZGUpO1xuICAgIC8vIENoYW5nZSBmdW5jdGlvbiB0byBub3QgYmUgYW4gZXhwb3J0XG4gICAgbm9kZS5mbGFncyA9IG5vZGUuZmxhZ3MgXiBDb21tb25GbGFncy5FWFBPUlQ7XG4gICAgdGhpcy53cmFwcGVkRnVuY3MuYWRkKHRvU3RyaW5nKG5vZGUubmFtZSkpO1xuICAgIHN1cGVyLnZpc2l0KG5vZGUpO1xuICB9XG5cbiAgLypcbiAgQ3JlYXRlIGEgd3JhcHBlciBmdW5jdGlvbiB0aGF0IHdpbGwgYmUgZXhwb3J0IGluIHRoZSBmdW5jdGlvbidzIHBsYWNlLlxuICAqL1xuICBwcml2YXRlIGdlbmVyYXRlV3JhcHBlckZ1bmN0aW9uKGZ1bmM6IEZ1bmN0aW9uRGVjbGFyYXRpb24pIHtcbiAgICBsZXQgc2lnbmF0dXJlID0gZnVuYy5zaWduYXR1cmU7XG4gICAgbGV0IHBhcmFtcyA9IHNpZ25hdHVyZS5wYXJhbWV0ZXJzO1xuICAgIGxldCByZXR1cm5UeXBlID0gc2lnbmF0dXJlLnJldHVyblR5cGU7XG4gICAgbGV0IHJldHVyblR5cGVOYW1lID0gdG9TdHJpbmcocmV0dXJuVHlwZSlcbiAgICAgIC5zcGxpdChcInxcIilcbiAgICAgIC5tYXAobmFtZSA9PiBuYW1lLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIobmFtZSA9PiBuYW1lICE9PSBcIm51bGxcIilcbiAgICAgIC5qb2luKFwifFwiKTtcbiAgICBsZXQgaGFzTnVsbCA9IHRvU3RyaW5nKHJldHVyblR5cGUpLmluY2x1ZGVzKFwibnVsbFwiKTtcbiAgICBsZXQgbmFtZSA9IGZ1bmMubmFtZS50ZXh0O1xuXG4gICAgdGhpcy5zYi5wdXNoKGBmdW5jdGlvbiBfX3dyYXBwZXJfJHtuYW1lfSgpOiB2b2lkIHtgKTtcbiAgICBpZiAocGFyYW1zLmxlbmd0aCA+IDApIHtcbiAgICAgIHRoaXMuc2IucHVzaChgICBjb25zdCBvYmogPSBnZXRJbnB1dCgpO2ApO1xuICAgIH1cbiAgICBpZiAodG9TdHJpbmcocmV0dXJuVHlwZSkgIT09IFwidm9pZFwiKSB7XG4gICAgICB0aGlzLnNiLnB1c2goYCAgbGV0IHJlc3VsdDogJHt0b1N0cmluZyhyZXR1cm5UeXBlKX0gPSAke25hbWV9KGApO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnNiLnB1c2goYCAgJHtuYW1lfShgKTtcbiAgICB9XG4gICAgaWYgKHBhcmFtcy5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLnNiW3RoaXMuc2IubGVuZ3RoIC0gMV0gKz0gcGFyYW1zXG4gICAgICAgIC5tYXAocGFyYW0gPT4gY3JlYXRlRGVjb2RlU3RhdGVtZW50KHBhcmFtKSlcbiAgICAgICAgLmpvaW4oXCIsIFwiKTtcbiAgICB9XG4gICAgdGhpcy5zYlt0aGlzLnNiLmxlbmd0aCAtIDFdICs9IFwiKTtcIjtcbiAgICBpZiAodG9TdHJpbmcocmV0dXJuVHlwZSkgIT09IFwidm9pZFwiKSB7XG4gICAgICB0aGlzLnNiLnB1c2goYCAgY29uc3QgdmFsID0gZW5jb2RlPCR7cmV0dXJuVHlwZU5hbWV9Pigke2hhc051bGwgPyBgY2hhbmdldHlwZTwke3JldHVyblR5cGVOYW1lfT4ocmVzdWx0KWAgOiBcInJlc3VsdFwifSk7XG4gIHZhbHVlX3JldHVybih2YWwuYnl0ZUxlbmd0aCwgdmFsLmRhdGFTdGFydCk7YCk7XG4gICAgfVxuICAgIHRoaXMuc2IucHVzaChgfVxuZXhwb3J0IHsgX193cmFwcGVyXyR7bmFtZX0gYXMgJHtuYW1lfSB9YCk7XG4gIH1cblxuICBwcml2YXRlIHR5cGVOYW1lKHR5cGU6IFR5cGVOb2RlIHwgQ2xhc3NEZWNsYXJhdGlvbik6IHN0cmluZyB7XG4gICAgaWYgKCFpc0NsYXNzKHR5cGUpKSB7XG4gICAgICByZXR1cm4gdG9TdHJpbmcodHlwZSk7XG4gICAgfVxuICAgIHR5cGUgPSA8Q2xhc3NEZWNsYXJhdGlvbj50eXBlO1xuICAgIGxldCBjbGFzc05hbWUgPSB0b1N0cmluZyh0eXBlLm5hbWUpO1xuICAgIGlmICh0eXBlLmlzR2VuZXJpYykge1xuICAgICAgY2xhc3NOYW1lICs9IFwiPFwiICsgdHlwZS50eXBlUGFyYW1ldGVycyEubWFwKHRvU3RyaW5nKS5qb2luKFwiLCBcIikgKyBcIj5cIjtcbiAgICB9XG4gICAgcmV0dXJuIGNsYXNzTmFtZTtcbiAgfVxuXG4gIGJ1aWxkKHNvdXJjZTogU291cmNlKTogc3RyaW5nIHtcbiAgICBjb25zdCBpc05lYXJGaWxlID0gc291cmNlLnRleHQuaW5jbHVkZXMoXCJAbmVhcmZpbGVcIilcbiAgICB0aGlzLnNiID0gW107XG4gICAgdGhpcy52aXNpdChzb3VyY2UpO1xuICAgIGxldCBzb3VyY2VUZXh0ID0gc291cmNlLnN0YXRlbWVudHMubWFwKHN0bXQgPT4ge1xuICAgICAgbGV0IHN0ciA9IHRvU3RyaW5nKHN0bXQpO1xuICAgICAgaWYgKFxuICAgICAgICBpc0NsYXNzKHN0bXQpICYmXG4gICAgICAgICh1dGlscy5oYXNEZWNvcmF0b3IoPENsYXNzRGVjbGFyYXRpb24+c3RtdCwgTkVBUl9ERUNPUkFUT1IpIHx8IGlzTmVhckZpbGUpXG4gICAgICAgICkge1xuICAgICAgICBsZXQgX2NsYXNzID0gPENsYXNzRGVjbGFyYXRpb24+c3RtdDtcbiAgICAgICAgc3RyID0gc3RyLnNsaWNlKDAsIHN0ci5sYXN0SW5kZXhPZihcIn1cIikpO1xuICAgICAgICBsZXQgZmllbGRzID0gX2NsYXNzLm1lbWJlcnNcbiAgICAgICAgICAuZmlsdGVyKGlzRmllbGQpXG4gICAgICAgICAgLm1hcCgoZmllbGQ6IEZpZWxkRGVjbGFyYXRpb24pID0+IGZpZWxkKTtcbiAgICAgICAgaWYgKGZpZWxkcy5zb21lKChmaWVsZCkgPT4gZmllbGQudHlwZSA9PSBudWxsKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkFsbCBGaWVsZHMgbXVzdCBoYXZlIGV4cGxpY3QgdHlwZSBkZWNsYXJhdGlvbi5cIik7XG4gICAgICAgIH1cbiAgICAgICAgbGV0IGNsYXNzTmFtZSA9IHRoaXMudHlwZU5hbWUoX2NsYXNzKTtcbiAgICAgICAgaWYgKCF1dGlscy5oYXNEZWNvcmF0b3IoPENsYXNzRGVjbGFyYXRpb24+c3RtdCwgTkVBUl9ERUNPUkFUT1IpKSB7XG4gICAgICAgICAgY29uc29sZS5lcnJvcihcIlxceDFiWzMxbVwiLCBgQG5lYXJmaWxlIGlzIGRlcHJlY2F0ZWQgdXNlIEAke05FQVJfREVDT1JBVE9SfSBkZWNvcmF0b3Igb24gJHtjbGFzc05hbWV9YCxcIlxceDFiWzBtXCIpO1xuICAgICAgICB9XG4gICAgICAgIHN0ciArPSBgXG4gIGRlY29kZTxfViA9IFVpbnQ4QXJyYXk+KGJ1ZjogX1YpOiAke2NsYXNzTmFtZX0ge1xuICAgIGxldCBqc29uOiBKU09OLk9iajtcbiAgICBpZiAoYnVmIGluc3RhbmNlb2YgVWludDhBcnJheSkge1xuICAgICAganNvbiA9IEpTT04ucGFyc2UoYnVmKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXNzZXJ0KGJ1ZiBpbnN0YW5jZW9mIEpTT04uT2JqLCBcImFyZ3VtZW50IG11c3QgYmUgVWludDhBcnJheSBvciBKc29uIE9iamVjdFwiKTtcbiAgICAgIGpzb24gPSA8SlNPTi5PYmo+IGJ1ZjtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuX2RlY29kZShqc29uKTtcbiAgfVxuXG4gIHN0YXRpYyBkZWNvZGUoYnVmOiBVaW50OEFycmF5KTogJHtjbGFzc05hbWV9IHtcbiAgICByZXR1cm4gZGVjb2RlPCR7Y2xhc3NOYW1lfT4oYnVmKTtcbiAgfVxuXG4gIHByaXZhdGUgX2RlY29kZShvYmo6IEpTT04uT2JqKTogJHtjbGFzc05hbWV9IHtcbiAgICAke2NyZWF0ZURlY29kZVN0YXRlbWVudHMoX2NsYXNzKS5qb2luKFwiXFxuICAgIFwiKX1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIF9lbmNvZGUobmFtZTogc3RyaW5nIHwgbnVsbCA9IFwiXCIsIF9lbmNvZGVyOiBKU09ORW5jb2RlciB8IG51bGwgPSBudWxsKTogSlNPTkVuY29kZXIge1xuICAgIGxldCBlbmNvZGVyID0gX2VuY29kZXIgPT0gbnVsbCA/IG5ldyBKU09ORW5jb2RlcigpIDogX2VuY29kZXI7XG4gICAgZW5jb2Rlci5wdXNoT2JqZWN0KG5hbWUpO1xuICAgICR7Y3JlYXRlRW5jb2RlU3RhdGVtZW50cyhfY2xhc3MpLmpvaW4oXCJcXG4gICAgXCIpfVxuICAgIGVuY29kZXIucG9wT2JqZWN0KCk7XG4gICAgcmV0dXJuIGVuY29kZXI7XG4gIH1cbiAgZW5jb2RlKCk6IFVpbnQ4QXJyYXkge1xuICAgIHJldHVybiB0aGlzLl9lbmNvZGUoKS5zZXJpYWxpemUoKTtcbiAgfVxuXG4gIHNlcmlhbGl6ZSgpOiBVaW50OEFycmF5IHtcbiAgICByZXR1cm4gdGhpcy5lbmNvZGUoKTtcbiAgfVxuXG4gIHRvSlNPTigpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLl9lbmNvZGUoKS50b1N0cmluZygpO1xuICB9XG59YDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBzdHI7XG4gICAgfSk7XG4gICAgcmV0dXJuIHNvdXJjZVRleHQuY29uY2F0KHRoaXMuc2IpLmpvaW4oXCJcXG5cIik7XG4gIH1cbn1cbiJdfQ==