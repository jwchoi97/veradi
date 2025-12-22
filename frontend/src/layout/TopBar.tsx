import { Link, useLocation, useNavigate } from "react-router-dom";
import { clearToken } from "@/auth";

export default function TopBar() {
  const loc = useLocation();
  const navigate = useNavigate();

  // Remove empty segments
  const rawSegments = loc.pathname.split("/").filter(Boolean);

  // ✅ Remove "home" duplication: if path is "/home", show only "Home"
  const segments = rawSegments[0] === "home" ? rawSegments.slice(1) : rawSegments;

  const onLogout = () => {
    clearToken();
    navigate("/login", { replace: true });
  };

  const breadcrumb = (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <Link to="/">Home</Link>

      {segments.map((seg, idx) => {
        // Rebuild "to" from rawSegments, but skipping removed "home" means:
        // If segments is sliced, the URL should start from "/home/..."
        const base = rawSegments[0] === "home" ? ["home"] : [];
        const to = "/" + [...base, ...segments.slice(0, idx + 1)].join("/");

        return (
          <span key={to}>
            <span className="sep">›</span>
            <Link to={to}>{seg}</Link>
          </span>
        );
      })}
    </nav>
  );

  return (
    <header className="topbar">
      <div className="brand">
        <Link to="/" className="logo">
          VERADI CONTENTS ERP
        </Link>
      </div>

      <div className="grow" />

      {/* ✅ Wrap breadcrumb to prevent layout shift */}
      <div className="topbar-breadcrumb">{breadcrumb}</div>

      <div className="topbar-right">
        <button onClick={onLogout} className="logout-btn">
          Logout
        </button>
      </div>
    </header>
  );
}

// import { Link, useLocation, useNavigate } from "react-router-dom";
// import { clearToken } from "@/auth";

// export default function TopBar() {
//   const loc = useLocation();
//   const navigate = useNavigate();
//   const segments = loc.pathname.split("/").filter(Boolean);

//   const onLogout = () => {
//     clearToken();
//     navigate("/login", { replace: true });
//   };

//   const breadcrumb = (
//     <nav className="breadcrumb">
//       <Link to="/">Home</Link>
//       {segments.map((seg, idx) => {
//         const to = "/" + segments.slice(0, idx + 1).join("/");
//         return (
//           <span key={to}>
//             <span className="sep">›</span>
//             <Link to={to}>{seg}</Link>
//           </span>
//         );
//       })}
//     </nav>
//   );

//   return (
//     <header className="topbar">
//       {/* 좌측: 브랜드 */}
//       <div className="brand">
//         <Link to="/" className="logo">
//           VERADI CONTENTS ERP
//         </Link>
//       </div>

//       {/* 가운데: breadcrumb */}
//       <div className="grow" />
//       {breadcrumb}

//       {/* 우측: 로그아웃 */}
//       <div className="topbar-right">
//         <button
//           onClick={onLogout}
//           className="logout-btn"
//         >
//           Logout
//         </button>
//       </div>
//     </header>
//   );
// }

// // import { Link, useLocation } from "react-router-dom";

// // export default function TopBar() {
// // const loc = useLocation();
// // const segments = loc.pathname.split("/").filter(Boolean);


// // const breadcrumb = (
// // <nav className="breadcrumb">
// // <Link to="/">Home</Link>
// // {segments.map((seg, idx) => {
// // const to = "/" + segments.slice(0, idx + 1).join("/");
// // return (
// // <span key={to}>
// // <span className="sep">›</span>
// // <Link to={to}>{seg}</Link>
// // </span>
// // );
// // })}
// // </nav>
// // );


// // return (
// // <header className="topbar">
// // <div className="brand">
// // <Link to="/" className="logo">VERADI CONTENTS ERP</Link>
// // </div>
// // <div className="grow" />
// // {breadcrumb}
// // </header>
// // );
// // }