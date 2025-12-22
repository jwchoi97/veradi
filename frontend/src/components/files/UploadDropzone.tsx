// import { useState } from "react";
// import { useUploadFile } from "../../data/files/queries";

// export default function UploadDropzone({ projectId }: { projectId: number }) {
//   const [file, setFile] = useState<File | null>(null);
//   const { mutateAsync, isPending } = useUploadFile();

//   const onUpload = async () => {
//     if (!file) return;
//     await mutateAsync({ projectId, file });
//     setFile(null);
//   };

//   return (
//     <div className="p-3 border rounded">
//       <input type="file" onChange={(e) => e.target.files && setFile(e.target.files[0])} />
//       <button
//         disabled={!file || isPending}
//         onClick={onUpload}
//         className="ml-2 px-3 py-1 bg-blue-600 text-white rounded"
//       >
//         {isPending ? "Uploading..." : "Upload"}
//       </button>
//     </div>
//   );
// }
