/**
 * Spinner — 로딩 스피너 컴포넌트.
 *
 * 3가지 모드:
 * - fullscreen: 전체 화면 로딩 (페이지 초기 로딩)
 * - inline: 콘텐츠 영역 내 로딩 (패널 내부)
 * - button: 버튼 내부 스피너 (submit 버튼 등)
 *
 * 사용 예:
 * <Spinner mode="fullscreen" text="LOADING..." />
 * <Spinner mode="inline" />
 * <Spinner mode="button" color="black" />
 */

interface SpinnerProps {
  mode?: "fullscreen" | "inline" | "button";
  text?: string;
  /** 스피너 테두리 색상. 기본: 'white' */
  color?: "white" | "black" | "gray";
}

const colorMap = {
  white: "border-white border-t-transparent",
  black: "border-black border-t-transparent",
  gray: "border-gray-400 border-t-transparent",
};

export default function Spinner({
  mode = "inline",
  text,
  color = "white",
}: SpinnerProps) {
  if (mode === "fullscreen") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div
            className={`w-8 h-8 border ${colorMap[color]} rounded-full animate-spin mx-auto mb-4`}
          ></div>
          {text && (
            <p className="text-white font-mono text-sm tracking-wider uppercase">
              {text}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (mode === "inline") {
    return (
      <div className="flex-1 min-h-[200px] flex items-center justify-center p-8">
        <div
          className={`w-6 h-6 border ${colorMap[color]} rounded-full animate-spin`}
        ></div>
        {text && (
          <span className="ml-2 text-white font-mono text-sm">{text}</span>
        )}
      </div>
    );
  }

  // button
  return (
    <div
      className={`w-4 h-4 border ${colorMap[color]} rounded-full animate-spin`}
    ></div>
  );
}
