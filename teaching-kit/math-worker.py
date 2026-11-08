"""Bounded JSON-in/JSON-out mathematics checks. No Python expression evaluation."""
import ast
import json
import math
import sys
import sympy as s
from sympy.calculus.util import continuous_domain

FUNCTIONS = {
    "sin": s.sin, "cos": s.cos, "tan": s.tan, "asin": s.asin,
    "acos": s.acos, "atan": s.atan, "exp": s.exp, "log": s.log,
    "ln": s.log, "sqrt": s.sqrt, "abs": s.Abs, "Abs": s.Abs,
}
SYMBOLS = {name: s.Symbol(name, real=True) for name in "x y z t a b c m n k".split()}


def parse(text):
    if not isinstance(text, str) or not 0 < len(text) <= 600:
        raise ValueError("表达式长度须为1–600；使用显式乘号，如2*x。")
    tree = ast.parse(text.replace("^", "**").replace("−", "-").replace("×", "*"), mode="eval")
    if len(list(ast.walk(tree))) > 150:
        raise ValueError("表达式过于复杂，请拆成小步。")

    def visit(node):
        if isinstance(node, ast.Expression):
            return visit(node.body)
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            if not math.isfinite(node.value) or abs(node.value) > 1e9:
                raise ValueError("数值超出校验范围。")
            return s.Rational(str(node.value))
        if isinstance(node, ast.Name):
            if node.id in SYMBOLS:
                return SYMBOLS[node.id]
            if node.id in ("pi", "E"):
                return getattr(s, node.id)
            raise ValueError("未知符号：" + node.id)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = visit(node.operand)
            return value if isinstance(node.op, ast.UAdd) else s.Mul(-1, value, evaluate=False)
        if isinstance(node, ast.BinOp):
            left, right = visit(node.left), visit(node.right)
            if isinstance(node.op, ast.Add):
                return s.Add(left, right, evaluate=False)
            if isinstance(node.op, ast.Sub):
                return s.Add(left, s.Mul(-1, right, evaluate=False), evaluate=False)
            if isinstance(node.op, ast.Mult):
                return s.Mul(left, right, evaluate=False)
            if isinstance(node.op, ast.Div):
                return s.Mul(left, s.Pow(right, -1, evaluate=False), evaluate=False)
            if isinstance(node.op, ast.Pow):
                if right.is_number and (right.is_real is not True or abs(float(right)) > 100):
                    raise ValueError("指数超出校验范围。")
                return s.Pow(left, right, evaluate=False)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id not in FUNCTIONS or node.keywords or len(node.args) != 1:
                raise ValueError("只允许所列数学函数的单参数调用。")
            arg = visit(node.args[0])
            if node.func.id == "sqrt":
                return s.Pow(arg, s.Rational(1, 2), evaluate=False)
            return FUNCTIONS[node.func.id](arg, evaluate=False)
        raise ValueError("不支持该语法；不能包含属性、代码、文件操作或任意函数。")

    return visit(tree)


def domain(expr, x):
    result = continuous_domain(expr, x, s.S.Reals)
    # Keep exclusions from the original tree even when algebraic simplification cancels them.
    for node in s.preorder_traversal(expr):
        if isinstance(node, s.Pow) and node.exp.is_negative:
            result = result - s.solveset(node.base, x, domain=s.S.Reals)
    return result


def describe(expr):
    return {"text": str(expr), "latex": s.latex(expr)}


def run(data):
    operation = data["operation"]
    x = SYMBOLS.get(data.get("variable", "x"))
    if x is None:
        raise ValueError("未知变量。")
    expr = parse(data["expression"])
    params = data.get("parameters", {})
    if len(params) > 6:
        raise ValueError("最多6个参数。")
    for name, value in params.items():
        if name not in SYMBOLS or SYMBOLS[name] == x or type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 1e6:
            raise ValueError("参数需为已知符号的有限数值，且不能覆盖自变量。")
    expr = expr.subs({SYMBOLS[k]: s.Rational(str(v)) for k, v in params.items()})
    if expr.free_symbols - {x}:
        raise ValueError("请先为其他符号提供数值参数。")
    output = {"ok": True, "operation": operation, "expression": describe(expr)}
    if operation == "domain":
        output["result"] = describe(domain(expr, x))
    elif operation == "differentiate":
        output["result"] = describe(s.diff(expr, x))
    elif operation == "integrate":
        output["result"] = describe(s.integrate(expr, x))
        output["note"] = "不定积分结果需加任意常数；未据此判定学生掌握。"
    elif operation == "simplify":
        output["result"] = describe(s.simplify(expr))
        output["original_domain"] = describe(domain(expr, x))
    elif operation == "equivalent":
        other = parse(data["other"]).subs({SYMBOLS[k]: s.Rational(str(v)) for k, v in params.items()})
        if other.free_symbols - {x}:
            raise ValueError("第二个表达式仍有未赋值参数。")
        equal = s.simplify(expr - other).equals(0)
        d1, d2 = domain(expr, x), domain(other, x)
        same_domain = d1 == d2
        output.update(algebraically_equal=equal, same_domain=same_domain,
                      equivalent_on_full_domain=bool(equal and same_domain),
                      original_domain=describe(d1), other_domain=describe(d2))
    elif operation == "inequality":
        relations = {">": s.Gt, ">=": s.Ge, "<": s.Lt, "<=": s.Le}
        relation = data.get("relation", ">")
        if relation not in relations:
            raise ValueError("关系只支持 >、>=、<、<=，右侧默认为0。")
        solved = s.solve_univariate_inequality(relations[relation](expr, 0), x, relational=False)
        output["result"] = describe(solved.intersect(domain(expr, x)))
    elif operation == "plot":
        lo, hi = data.get("x_min", -10), data.get("x_max", 10)
        count = data.get("samples", 401)
        if type(count) is not int or not 30 <= count <= 1000 or not all(type(v) in (int, float) and math.isfinite(v) for v in (lo, hi)) or not -1e6 <= lo < hi <= 1e6:
            raise ValueError("图形范围或采样数量无效。")
        fn = s.lambdify(x, expr, modules="math")
        points = []
        for i in range(count):
            value = lo + (hi - lo) * i / (count - 1)
            try:
                y = float(fn(value))
                if not math.isfinite(y) or abs(y) > 1e8:
                    y = None
            except (ValueError, ZeroDivisionError, TypeError, OverflowError):
                y = None
            points.append([value, y])
        output.update(points=points, sampled=True, note="采样图不能证明连续性、定义域或精确端点；精确结论另用domain校验。")
    else:
        raise ValueError("未知数学操作。")
    return output


try:
    data = json.loads(sys.stdin.buffer.read(32769).decode("utf-8"))
    print(json.dumps(run(data), ensure_ascii=True))
except (NotImplementedError, s.PolynomialError) as exc:
    print(json.dumps({"ok": False, "status": "unsupported", "error": "当前符号工具不能可靠处理此题，请教师独立核对。"}, ensure_ascii=True))
except Exception as exc:
    print(json.dumps({"ok": False, "status": "invalid", "error": str(exc)[:400]}, ensure_ascii=True))
