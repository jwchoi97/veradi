// frontend/src/components/files/UploadDropzone.tsx
import React, { useCallback, useMemo, useRef, useState } from "react";

type Props = {
  accept?: string; // e.g. ".pdf,.hwp" or "" (no restriction)
  disabled?: boolean;
  multiple?: boolean; // default true
  onFiles: (files: File[]) => void | Promise<void>;
  onReject?: (message: string) => void;
  className?: string;
  compact?: boolean; // default false
  showLastAdded?: boolean; // default true
  showHintText?: boolean; // ✅ default true, modal에서 false로 사용 가능
};

function uniqByNameSize(files: File[]) {
  const map = new Map<string, File>();
  for (const f of files) map.set(`${f.name}__${f.size}`, f);
  return Array.from(map.values());
}

function getExtLower(name: string) {
  const i = name.lastIndexOf(".");
  if (i < 0) return "";
  return name.slice(i).toLowerCase();
}

export default function UploadDropzone({
  accept = ".pdf,.hwp",
  disabled,
  multiple = true,
  onFiles,
  onReject,
  className,
  compact = false,
  showLastAdded = true,
  showHintText = true,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lastAdded, setLastAdded] = useState<string>("");

  const acceptSet = useMemo(() => {
    const exts = accept
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.startsWith("."));
    return new Set(exts);
  }, [accept]);

  const filterAccepted = useCallback(
    (files: File[]) => {
      const exts = Array.from(acceptSet);
      if (exts.length === 0) return { accepted: files, rejected: [] as File[] };

      const accepted: File[] = [];
      const rejected: File[] = [];

      for (const f of files) {
        const ext = getExtLower(f.name);
        if (acceptSet.has(ext)) accepted.push(f);
        else rejected.push(f);
      }
      return { accepted, rejected };
    },
    [acceptSet]
  );

  const handleFiles = useCallback(
    async (raw: File[]) => {
      if (disabled) return;

      const uniq = uniqByNameSize(raw);

      if (!multiple && uniq.length > 1) {
        onReject?.("한 번에 1개 파일만 업로드할 수 있습니다.");
        return;
      }

      const { accepted, rejected } = filterAccepted(uniq);

      if (rejected.length > 0) {
        const names = rejected.map((f) => f.name).join(", ");
        const allowed = accept ? accept.replaceAll(",", ", ") : "(제한 없음)";
        onReject?.(`허용되지 않는 파일 형식입니다. (허용: ${allowed})\n대상: ${names}`);
      }

      if (accepted.length === 0) return;

      if (showLastAdded) setLastAdded(accepted.map((f) => f.name).join(", "));
      await onFiles(accepted);
    },
    [accept, disabled, filterAccepted, multiple, onFiles, onReject, showLastAdded]
  );

  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;

      setIsDragging(false);

      const dt = e.dataTransfer;
      const files: File[] = [];

      if (dt?.items && dt.items.length > 0) {
        for (const item of Array.from(dt.items)) {
          if (item.kind === "file") {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
      } else if (dt?.files && dt.files.length > 0) {
        files.push(...Array.from(dt.files));
      }

      await handleFiles(files);
    },
    [disabled, handleFiles]
  );

  const onDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      setIsDragging(true);
    },
    [disabled]
  );

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const onClick = useCallback(() => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const onInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      const files = e.target.files ? Array.from(e.target.files) : [];
      e.target.value = "";
      await handleFiles(files);
    },
    [disabled, handleFiles]
  );

  const pad = compact ? "p-3" : "p-6";
  const textSub = compact ? "text-[11px]" : "text-xs";
  const allowedText = accept ? accept.replaceAll(",", ", ") : "(제한 없음)";

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onClick();
        }}
        className={[
          "w-full rounded-xl border-2 border-dashed transition",
          pad,
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
          isDragging ? "border-gray-900 bg-gray-50" : "border-gray-300 bg-white hover:bg-gray-50",
        ].join(" ")}
      >
        {/* ✅ hint 텍스트 숨김 가능 (모달에서는 숨길거) */}
        {showHintText ? (
          <div className="text-center text-xs text-gray-600">드래그&드롭 또는 클릭</div>
        ) : null}

        {/* ✅ 허용 문구는 항상 왼쪽 정렬 */}
        <div className={`mt-1 ${textSub} text-gray-500 text-left`}>허용: {allowedText}</div>

        {showLastAdded && lastAdded ? (
          <div className={`mt-2 ${textSub} text-gray-400 text-left`}>Last: {lastAdded}</div>
        ) : null}

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={onInputChange}
          className="hidden"
        />
      </div>
    </div>
  );
}

// // frontend/src/components/files/UploadDropzone.tsx
// import React, { useCallback, useMemo, useRef, useState } from "react";

// type Props = {
//   title?: string;
//   description?: string;
//   accept?: string; // e.g. ".pdf,.hwp"
//   disabled?: boolean;
//   multiple?: boolean; // default true
//   onFiles: (files: File[]) => void | Promise<void>;
//   onReject?: (message: string) => void; // ✅ new
//   className?: string;
//   compact?: boolean; // default false
//   showLastAdded?: boolean; // default true
// };

// function uniqByNameSize(files: File[]) {
//   const map = new Map<string, File>();
//   for (const f of files) map.set(`${f.name}__${f.size}`, f);
//   return Array.from(map.values());
// }

// function getExtLower(name: string) {
//   const i = name.lastIndexOf(".");
//   if (i < 0) return "";
//   return name.slice(i).toLowerCase();
// }

// export default function UploadDropzone({
//   title,
//   description,
//   accept = ".pdf,.hwp",
//   disabled,
//   multiple = true,
//   onFiles,
//   onReject,
//   className,
//   compact = false,
//   showLastAdded = true,
// }: Props) {
//   const inputRef = useRef<HTMLInputElement | null>(null);
//   const [isDragging, setIsDragging] = useState(false);
//   const [lastAdded, setLastAdded] = useState<string>("");

//   const acceptSet = useMemo(() => {
//     const exts = accept
//       .split(",")
//       .map((s) => s.trim().toLowerCase())
//       .filter((s) => s.startsWith("."));
//     return new Set(exts);
//   }, [accept]);

//   const filterAccepted = useCallback(
//     (files: File[]) => {
//       const exts = Array.from(acceptSet);
//       if (exts.length === 0) return { accepted: files, rejected: [] as File[] };

//       const accepted: File[] = [];
//       const rejected: File[] = [];

//       for (const f of files) {
//         const ext = getExtLower(f.name);
//         if (acceptSet.has(ext)) accepted.push(f);
//         else rejected.push(f);
//       }
//       return { accepted, rejected };
//     },
//     [acceptSet]
//   );

//   const handleFiles = useCallback(
//     async (raw: File[]) => {
//       if (disabled) return;

//       const uniq = uniqByNameSize(raw);

//       if (!multiple && uniq.length > 1) {
//         onReject?.("한 번에 1개 파일만 업로드할 수 있습니다.");
//         return;
//       }

//       const { accepted, rejected } = filterAccepted(uniq);

//       if (rejected.length > 0) {
//         const names = rejected.map((f) => f.name).join(", ");
//         const allowed = accept.replaceAll(",", ", ");
//         onReject?.(`허용되지 않는 파일 형식입니다. (허용: ${allowed})\n대상: ${names}`);
//       }

//       if (accepted.length === 0) return;

//       if (showLastAdded) setLastAdded(accepted.map((f) => f.name).join(", "));
//       await onFiles(accepted);
//     },
//     [accept, disabled, filterAccepted, multiple, onFiles, onReject, showLastAdded]
//   );

//   const onDrop = useCallback(
//     async (e: React.DragEvent<HTMLDivElement>) => {
//       e.preventDefault();
//       e.stopPropagation();
//       if (disabled) return;

//       setIsDragging(false);

//       const dt = e.dataTransfer;
//       const files: File[] = [];

//       if (dt?.items && dt.items.length > 0) {
//         for (const item of Array.from(dt.items)) {
//           if (item.kind === "file") {
//             const f = item.getAsFile();
//             if (f) files.push(f);
//           }
//         }
//       } else if (dt?.files && dt.files.length > 0) {
//         files.push(...Array.from(dt.files));
//       }

//       await handleFiles(files);
//     },
//     [disabled, handleFiles]
//   );

//   const onDragOver = useCallback(
//     (e: React.DragEvent<HTMLDivElement>) => {
//       e.preventDefault();
//       e.stopPropagation();
//       if (disabled) return;
//       setIsDragging(true);
//     },
//     [disabled]
//   );

//   const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
//     e.preventDefault();
//     e.stopPropagation();
//     setIsDragging(false);
//   }, []);

//   const onClick = useCallback(() => {
//     if (disabled) return;
//     inputRef.current?.click();
//   }, [disabled]);

//   const onInputChange = useCallback(
//     async (e: React.ChangeEvent<HTMLInputElement>) => {
//       if (disabled) return;
//       const files = e.target.files ? Array.from(e.target.files) : [];
//       e.target.value = "";
//       await handleFiles(files);
//     },
//     [disabled, handleFiles]
//   );

//   const pad = compact ? "p-3" : "p-6";
//   const textMain = compact ? "text-xs" : "text-sm";
//   const textSub = compact ? "text-[11px]" : "text-xs";

//   return (
//     <div className={className}>
//       {(title || description) && (
//         <div className="mb-2">
//           {title ? <div className="font-semibold">{title}</div> : null}
//           {description ? <div className="text-sm text-gray-600">{description}</div> : null}
//         </div>
//       )}

//       <div
//         role="button"
//         tabIndex={0}
//         onClick={onClick}
//         onDrop={onDrop}
//         onDragOver={onDragOver}
//         onDragLeave={onDragLeave}
//         onKeyDown={(e) => {
//           if (e.key === "Enter" || e.key === " ") onClick();
//         }}
//         className={[
//           "w-full rounded-xl border-2 border-dashed text-center transition",
//           pad,
//           disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
//           isDragging ? "border-gray-900 bg-gray-50" : "border-gray-300 bg-white hover:bg-gray-50",
//         ].join(" ")}
//       >
//         <div className={`${textMain} font-medium`}>
//           드래그&드롭 또는 클릭{multiple ? " (여러 파일 가능)" : " (1개만 가능)"}
//         </div>
//         <div className={`mt-1 ${textSub} text-gray-500`}>허용: {accept.replaceAll(",", ", ")}</div>
//         {showLastAdded && lastAdded ? (
//           <div className={`mt-2 ${textSub} text-gray-400`}>Last: {lastAdded}</div>
//         ) : null}

//         <input
//           ref={inputRef}
//           type="file"
//           accept={accept}
//           multiple={multiple}
//           disabled={disabled}
//           onChange={onInputChange}
//           className="hidden"
//         />
//       </div>
//     </div>
//   );
// }
