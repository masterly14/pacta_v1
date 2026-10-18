import type { CSSProperties } from "react";
import Link from "next/link";

function css(style: CSSProperties & Record<string, string | number>) {
  return style as CSSProperties;
}

export function LandingPage({
  enterHref,
  className,
}: {
  enterHref: string;
  className?: string;
}) {
  return (
    <div className={className ? `${className} landing` : "landing"}>
    <section style={css({"position":"relative","minHeight":"100vh","overflow":"hidden","background":"#f7f6f4","color":"#111"})}>
      <div style={css({"position":"absolute","inset":"0","zIndex":"1","pointerEvents":"none","WebkitMaskImage":"url(\"/landing/mask.svg\")","maskImage":"url(\"/landing/mask.svg\")","WebkitMaskSize":"100% 100%","maskSize":"100% 100%","animation":"pacta-land-reveal 3.2s .2s cubic-bezier(.45,.05,.2,1) both"})}>
        <div style={css({"position":"absolute","inset":"0","background":"linear-gradient(100deg,#8fd4b0 0%,#d7f6e6 34%,#f7fcf9 58%,#c9f0db 100%)","backgroundSize":"130% 100%","animation":"pacta-land-shift 14s ease-in-out infinite"})} />
        <div style={css({"position":"absolute","inset":"0","mixBlendMode":"soft-light","opacity":"1","backgroundImage":"url(\"/landing/grain.svg?v=5\")"})} />
      </div>
      <nav style={css({"position":"absolute","top":"16px","left":"50%","transform":"translateX(-50%)","width":"min(1180px,calc(100% - 32px))","boxSizing":"border-box","zIndex":"20","display":"flex","alignItems":"center","justifyContent":"space-between","gap":"16px","padding":"10px 12px 10px 22px","borderRadius":"999px","background":"rgba(255,255,255,.72)","backdropFilter":"blur(16px)","WebkitBackdropFilter":"blur(16px)","boxShadow":"0 1px 2px rgba(0,0,0,.05),0 8px 30px rgba(60,30,10,.06)","animation":"pacta-land-fadeIn .8s ease both"})}>
        <Link href="/" style={css({"display":"flex","alignItems":"center"})}>
          <img src="/landing/logo.png" alt="Pacta" style={css({"height":"32px","width":"auto","display":"block"})} />
        </Link>
        <div style={css({"display":"flex","gap":"8px"})}>
          <Link className="lift" href={enterHref} style={css({"padding":"11px 20px","borderRadius":"999px","background":"#111","color":"#fff","fontSize":"15px","fontWeight":"500","transition":"transform .25s,box-shadow .25s"})}>Entrar a Pacta</Link>
        </div>
      </nav>
      <div style={css({"position":"relative","zIndex":"10","maxWidth":"860px","margin":"0 auto","padding":"150px 20px 0","display":"flex","flexDirection":"column","alignItems":"center","textAlign":"center"})}>
        <a className="lift-soft" href="#como-funciona" style={css({"display":"flex","alignItems":"center","gap":"12px","padding":"8px 18px 8px 8px","borderRadius":"16px","background":"#fff","boxShadow":"0 1px 3px rgba(0,0,0,.06),0 6px 20px rgba(0,0,0,.04)","fontSize":"17px","color":"#333","animation":"pacta-land-up .9s .1s cubic-bezier(.2,.7,.2,1) both","transition":"transform .3s"})}>
          <span style={css({"background":"#111","color":"#fff","fontSize":"15px","fontWeight":"500","padding":"6px 12px","borderRadius":"10px","letterSpacing":".02em"})}>NUEVO</span>
          Tus pagos en automático →
        </a>
        <h1 style={css({"margin":"34px 0 0","fontSize":"clamp(44px,7vw,92px)","lineHeight":".98","letterSpacing":"-.055em","fontWeight":"500","color":"#111","textWrap":"balance","animation":"pacta-land-up 1s .25s cubic-bezier(.2,.7,.2,1) both"})}>Tu empresa tiene obligaciones, Pacta las paga.</h1>
        <p style={css({"margin":"28px 0 0","maxWidth":"640px","fontSize":"clamp(18px,2vw,24px)","lineHeight":"1.38","letterSpacing":"-.02em","color":"#6b6866","textWrap":"pretty","animation":"pacta-land-up 1s .4s cubic-bezier(.2,.7,.2,1) both"})}>
          Pacta conoce las obligaciones programadas de tu empresa, identifica cuándo vencen, reúne la evidencia y paga. Si nota algo raro, te avisa.
        </p>
        <div style={css({"marginTop":"36px","width":"min(560px,100%)","animation":"pacta-land-up 1s .55s cubic-bezier(.2,.7,.2,1) both"})}>
          <div data-pill="" style={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"10px","padding":"7px 7px 7px 28px","borderRadius":"999px","background":"#fff","boxShadow":"0 1px 3px rgba(0,0,0,.06),0 12px 36px rgba(80,40,20,.08)"})}>
            <a className="ink" href="#como-funciona" style={css({"fontSize":"18px","color":"#555","display":"flex","alignItems":"center","gap":"8px","letterSpacing":"-.01em"})}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="6.5" />
                <path d="M6.5 5.5l4 2.5-4 2.5z" fill="currentColor" />
              </svg>
              Ver cómo funciona
            </a>
            <Link className="lift-strong" href={enterHref} style={css({"display":"flex","alignItems":"center","gap":"8px","padding":"16px 28px","borderRadius":"999px","background":"#111","color":"#fff","fontSize":"19px","fontWeight":"500","transition":"transform .25s,box-shadow .25s"})}>
              Entrar a Pacta
              <span>→</span>
            </Link>
          </div>
          <div style={css({"margin":"-6px 12px 0","padding":"14px 16px 8px","borderRadius":"0 0 22px 22px","background":"rgba(0,0,0,.035)","fontSize":"16px","color":"#6b6866","letterSpacing":"-.01em","display":"flex","justifyContent":"center","gap":"10px","flexWrap":"wrap"})}>
            <span>Piloto automático con frenos</span>
            <span style={css({"opacity":".4"})}>·</span>
            <span>Las reglas deciden, la IA solo lee</span>
          </div>
        </div>
      </div>
      <div data-mock="" style={css({"position":"relative","zIndex":"5","width":"min(1180px,86%)","margin":"70px auto 0","height":"420px","overflow":"hidden","borderRadius":"22px 22px 0 0","background":"rgba(255,255,255,.55)","padding":"12px 0 0 12px","boxSizing":"border-box","boxShadow":"0 -10px 60px rgba(120,80,200,.12)","animation":"pacta-land-rise 1.3s .7s cubic-bezier(.2,.7,.2,1) both"})}>
        <div style={css({"background":"#fff","height":"100%","borderRadius":"14px 0 0 0","overflow":"hidden"})}>
          <img src="/landing/panel.png" alt="Panel de Pacta" style={css({"display":"block","width":"100%","height":"auto"})} />
        </div>
      </div>
      <div data-rk="" style={css({"position":"absolute","right":"0","bottom":"190px","width":"min(38vw,500px)","zIndex":"4","pointerEvents":"none"})}>
        <div data-rx="">
          <div style={css({"position":"absolute","inset":"18% -10% -6% 4%","background":"radial-gradient(ellipse,rgba(172,118,240,.65),rgba(236,170,214,.35) 50%,rgba(255,255,255,0) 72%)","filter":"blur(30px)"})} />
          <div style={css({"position":"relative"})}>
            <div>
              <img src="/landing/mark.png" alt="" style={css({"display":"block","width":"100%","height":"auto","mixBlendMode":"multiply"})} />
            </div>
          </div>
        </div>
      </div>
    </section>

    <section style={css({"position":"relative","padding":"clamp(72px,10vw,130px) 24px","background":"#f7f6f4","color":"#111"})}>
      <div style={css({"maxWidth":"1180px","margin":"0 auto"})}>
        <div style={css({"display":"flex","gap":"10px","alignItems":"center","fontSize":"15px","fontWeight":"500","color":"#444"})}>
          <span style={css({"width":"28px","height":"28px","borderRadius":"50%","background":"#111","color":"#fff","display":"grid","placeItems":"center","fontSize":"13px"})}>1</span>
          El problema
        </div>
        <h2 style={css({"margin":"22px 0 0","maxWidth":"880px","fontSize":"clamp(34px,4.8vw,64px)","lineHeight":"1.02","letterSpacing":"-.05em","fontWeight":"500","textWrap":"balance"})}>Revisar facturas a mano es lento y arriesgado.</h2>
        <p style={css({"margin":"22px 0 0","maxWidth":"720px","fontSize":"clamp(17px,1.7vw,21px)","lineHeight":"1.45","letterSpacing":"-.015em","color":"#6b6866","textWrap":"pretty"})}>
          Una empresa con proveedores en varios países recibe facturas por distintos canales. Su equipo financiero abre cada documento, lo compara con el contrato, consulta antecedentes, valida el presupuesto y pide aprobaciones manuales. Todo eso antes de poder pagar.
        </p>
        <div style={css({"marginTop":"64px"})}>
          <div style={css({"display":"grid","gridTemplateColumns":"repeat(auto-fit,minmax(200px,1fr))","gap":"16px"})}>
            <div style={css({"background":"#fff","borderRadius":"22px","boxShadow":"0 1px 3px rgba(0,0,0,.05),0 14px 40px rgba(60,30,10,.07)","padding":"26px 24px","display":"flex","flexDirection":"column","gap":"18px"})}>
              <span style={css({"width":"52px","height":"52px","borderRadius":"16px","background":"#f1efec","display":"grid","placeItems":"center","color":"#111"})}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 3h8l4 4v14H6z" />
                  <path d="M14 3v4h4M9 12h6M9 16h6" />
                </svg>
              </span>
              <span style={css({"fontSize":"20px","fontWeight":"500","letterSpacing":"-.02em"})}>Documentos</span>
            </div>
            <div style={css({"background":"#fff","borderRadius":"22px","boxShadow":"0 1px 3px rgba(0,0,0,.05),0 14px 40px rgba(60,30,10,.07)","padding":"26px 24px","display":"flex","flexDirection":"column","gap":"18px"})}>
              <span style={css({"width":"52px","height":"52px","borderRadius":"16px","background":"#f1efec","display":"grid","placeItems":"center","color":"#111"})}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 4h14v8M5 4v16h7" />
                  <path d="M8 8h8M8 12h4" />
                  <path d="M14 20l1-3 5-5 2 2-5 5z" />
                </svg>
              </span>
              <span style={css({"fontSize":"20px","fontWeight":"500","letterSpacing":"-.02em"})}>Contratos</span>
            </div>
            <div style={css({"background":"#fff","borderRadius":"22px","boxShadow":"0 1px 3px rgba(0,0,0,.05),0 14px 40px rgba(60,30,10,.07)","padding":"26px 24px","display":"flex","flexDirection":"column","gap":"18px"})}>
              <span style={css({"width":"52px","height":"52px","borderRadius":"16px","background":"#f1efec","display":"grid","placeItems":"center","color":"#111"})}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </span>
              <span style={css({"fontSize":"20px","fontWeight":"500","letterSpacing":"-.02em"})}>Historial de pagos</span>
            </div>
            <div style={css({"background":"#fff","borderRadius":"22px","boxShadow":"0 1px 3px rgba(0,0,0,.05),0 14px 40px rgba(60,30,10,.07)","padding":"26px 24px","display":"flex","flexDirection":"column","gap":"18px"})}>
              <span style={css({"width":"52px","height":"52px","borderRadius":"16px","background":"#f1efec","display":"grid","placeItems":"center","color":"#111"})}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M8 12l3 3 5-6" />
                </svg>
              </span>
              <span style={css({"fontSize":"20px","fontWeight":"500","letterSpacing":"-.02em"})}>Aprobaciones</span>
            </div>
          </div>
          <svg viewBox="0 0 1000 130" preserveAspectRatio="none" style={css({"display":"block","width":"100%","height":"130px"})}>
            <g fill="none" stroke="#c9c5c0" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeDasharray="6 6">
              <path d="M125 0 C125 80 500 50 500 124" vectorEffect="non-scaling-stroke" style={css({"animation":"pacta-land-dash 2s linear infinite"})} />
              <path d="M375 0 C375 80 500 50 500 124" vectorEffect="non-scaling-stroke" style={css({"animation":"pacta-land-dash 2s linear infinite"})} />
              <path d="M625 0 C625 80 500 50 500 124" vectorEffect="non-scaling-stroke" style={css({"animation":"pacta-land-dash 2s linear infinite"})} />
              <path d="M875 0 C875 80 500 50 500 124" vectorEffect="non-scaling-stroke" style={css({"animation":"pacta-land-dash 2s linear infinite"})} />
            </g>
          </svg>
          <div style={css({"display":"flex","justifyContent":"center"})}>
            <div style={css({"display":"flex","alignItems":"center","gap":"14px","padding":"14px 26px","borderRadius":"99px","background":"#111","color":"#fff","fontSize":"18px","fontWeight":"500"})}>
              <span style={css({"width":"12px","height":"12px","borderRadius":"50%","background":"#e63e10","animation":"pacta-land-pulse 1.8s ease-in-out infinite"})} />
              Y recién entonces, pagar
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="como-funciona" style={css({"position":"relative","padding":"clamp(72px,10vw,130px) 24px","background":"#fff","color":"#111"})}>
      <div style={css({"maxWidth":"1180px","margin":"0 auto"})}>
        <div style={css({"display":"flex","gap":"10px","alignItems":"center","fontSize":"15px","fontWeight":"500","color":"#444"})}>
          <span style={css({"width":"28px","height":"28px","borderRadius":"50%","background":"#111","color":"#fff","display":"grid","placeItems":"center","fontSize":"13px"})}>2</span>
          Cómo funciona
        </div>
        <h2 style={css({"margin":"22px 0 0","maxWidth":"880px","fontSize":"clamp(34px,4.8vw,64px)","lineHeight":"1.02","letterSpacing":"-.05em","fontWeight":"500","textWrap":"balance"})}>De la factura a una decisión, en cinco pasos.</h2>
        <div style={css({"marginTop":"60px","display":"grid","gridTemplateColumns":"repeat(auto-fit,minmax(200px,1fr))","gap":"28px 20px"})}>
          <div>
            <div style={css({"display":"flex","alignItems":"center","gap":"10px"})}>
              <span style={css({"flex":"none","width":"44px","height":"44px","borderRadius":"50%","border":"1.5px solid #d9d5d0","display":"grid","placeItems":"center","fontSize":"17px","fontWeight":"500","background":"#fff","animation":"pacta-land-lit 10s 0s ease-in-out infinite"})}>1</span>
              <span style={css({"flex":"1","height":"2px","background":"repeating-linear-gradient(90deg,#d9d5d0 0 6px,transparent 6px 12px)"})} />
            </div>
            <h3 style={css({"margin":"20px 0 8px","fontSize":"24px","fontWeight":"500","letterSpacing":"-.03em"})}>Llega</h3>
            <p style={css({"margin":"0","fontSize":"17px","lineHeight":"1.5","color":"#6b6866","textWrap":"pretty"})}>
              La factura entra por correo (PDF, imagen o texto en el cuerpo del mensaje) o por carga manual.
            </p>
          </div>
          <div>
            <div style={css({"display":"flex","alignItems":"center","gap":"10px"})}>
              <span style={css({"flex":"none","width":"44px","height":"44px","borderRadius":"50%","border":"1.5px solid #d9d5d0","display":"grid","placeItems":"center","fontSize":"17px","fontWeight":"500","background":"#fff","animation":"pacta-land-lit 10s 1.3s ease-in-out infinite"})}>2</span>
              <span style={css({"flex":"1","height":"2px","background":"repeating-linear-gradient(90deg,#d9d5d0 0 6px,transparent 6px 12px)"})} />
            </div>
            <h3 style={css({"margin":"20px 0 8px","fontSize":"24px","fontWeight":"500","letterSpacing":"-.03em"})}>Se lee</h3>
            <p style={css({"margin":"0","fontSize":"17px","lineHeight":"1.5","color":"#6b6866","textWrap":"pretty"})}>
              La IA extrae los datos y se validan con un esquema estricto. Lo que falta se marca como desconocido; nunca se inventa.
            </p>
          </div>
          <div>
            <div style={css({"display":"flex","alignItems":"center","gap":"10px"})}>
              <span style={css({"flex":"none","width":"44px","height":"44px","borderRadius":"50%","border":"1.5px solid #d9d5d0","display":"grid","placeItems":"center","fontSize":"17px","fontWeight":"500","background":"#fff","animation":"pacta-land-lit 10s 2.6s ease-in-out infinite"})}>3</span>
              <span style={css({"flex":"1","height":"2px","background":"repeating-linear-gradient(90deg,#d9d5d0 0 6px,transparent 6px 12px)"})} />
            </div>
            <h3 style={css({"margin":"20px 0 8px","fontSize":"24px","fontWeight":"500","letterSpacing":"-.03em"})}>Se contextualiza</h3>
            <p style={css({"margin":"0","fontSize":"17px","lineHeight":"1.5","color":"#6b6866","textWrap":"pretty"})}>
              Pacta la cruza con el proveedor, el contrato, el historial de pagos y las políticas de la empresa.
            </p>
          </div>
          <div>
            <div style={css({"display":"flex","alignItems":"center","gap":"10px"})}>
              <span style={css({"flex":"none","width":"44px","height":"44px","borderRadius":"50%","border":"1.5px solid #d9d5d0","display":"grid","placeItems":"center","fontSize":"17px","fontWeight":"500","background":"#fff","animation":"pacta-land-lit 10s 3.9000000000000004s ease-in-out infinite"})}>4</span>
              <span style={css({"flex":"1","height":"2px","background":"repeating-linear-gradient(90deg,#d9d5d0 0 6px,transparent 6px 12px)"})} />
            </div>
            <h3 style={css({"margin":"20px 0 8px","fontSize":"24px","fontWeight":"500","letterSpacing":"-.03em"})}>Se decide</h3>
            <p style={css({"margin":"0","fontSize":"17px","lineHeight":"1.5","color":"#6b6866","textWrap":"pretty"})}>Un motor determinista aplica las reglas y registra una de tres decisiones.</p>
          </div>
          <div>
            <div style={css({"display":"flex","alignItems":"center","gap":"10px"})}>
              <span style={css({"flex":"none","width":"44px","height":"44px","borderRadius":"50%","border":"1.5px solid #d9d5d0","display":"grid","placeItems":"center","fontSize":"17px","fontWeight":"500","background":"#fff","animation":"pacta-land-lit 10s 5.2s ease-in-out infinite"})}>5</span>
              <span style={css({"flex":"1","height":"2px","background":"repeating-linear-gradient(90deg,#d9d5d0 0 6px,transparent 6px 12px)"})} />
            </div>
            <h3 style={css({"margin":"20px 0 8px","fontSize":"24px","fontWeight":"500","letterSpacing":"-.03em"})}>Se explica</h3>
            <p style={css({"margin":"0","fontSize":"17px","lineHeight":"1.5","color":"#6b6866","textWrap":"pretty"})}>Cada decisión guarda las reglas evaluadas, la evidencia usada y el motivo.</p>
          </div>
        </div>
        <div style={css({"marginTop":"72px","borderRadius":"28px","background":"#f7f6f4","padding":"clamp(24px,4vw,48px)","display":"flex","alignItems":"center","justifyContent":"center","gap":"0","flexWrap":"wrap"})}>
          <div style={css({"background":"#fff","borderRadius":"22px","boxShadow":"0 1px 3px rgba(0,0,0,.05),0 14px 40px rgba(60,30,10,.07)","padding":"18px 22px","display":"flex","alignItems":"center","gap":"12px","fontWeight":"500","fontSize":"18px"})}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3h8l4 4v14H6z" />
              <path d="M14 3v4h4M9 12h6M9 16h6" />
            </svg>
            Factura
          </div>
          <svg width="280" height="160" viewBox="0 0 280 160" style={css({"flex":"none","maxWidth":"42vw"})}>
            <g fill="none" strokeWidth="2.5" strokeDasharray="7 6">
              <path d="M0 80 C100 80 120 25 280 25" stroke="#1e9e6a" style={css({"animation":"pacta-land-dash 1.6s linear infinite"})} />
              <path d="M0 80 C100 80 120 80 280 80" stroke="#f59a0b" style={css({"animation":"pacta-land-dash 1.6s linear infinite"})} />
              <path d="M0 80 C100 80 120 135 280 135" stroke="#f0285a" style={css({"animation":"pacta-land-dash 1.6s linear infinite"})} />
            </g>
            <circle cx="0" cy="80" r="5" fill="#111" />
          </svg>
          <div style={css({"position":"relative","width":"230px","height":"160px","flex":"none"})}>
            <span style={css({"position":"absolute","left":"0","top":"7px","padding":"9px 16px","borderRadius":"99px","background":"#e6f6ee","color":"#111","fontSize":"16px","fontWeight":"500","display":"flex","alignItems":"center","gap":"9px","whiteSpace":"nowrap"})}>
              <i style={css({"width":"10px","height":"10px","borderRadius":"50%","background":"#1e9e6a"})} />
              Aprobada
            </span>
            <span style={css({"position":"absolute","left":"0","top":"62px","padding":"9px 16px","borderRadius":"99px","background":"#fff3de","color":"#111","fontSize":"16px","fontWeight":"500","display":"flex","alignItems":"center","gap":"9px","whiteSpace":"nowrap"})}>
              <i style={css({"width":"10px","height":"10px","borderRadius":"50%","background":"#f59a0b"})} />
              Requiere aprobación
            </span>
            <span style={css({"position":"absolute","left":"0","top":"117px","padding":"9px 16px","borderRadius":"99px","background":"#fde6ec","color":"#111","fontSize":"16px","fontWeight":"500","display":"flex","alignItems":"center","gap":"9px","whiteSpace":"nowrap"})}>
              <i style={css({"width":"10px","height":"10px","borderRadius":"50%","background":"#f0285a"})} />
              Bloqueada
            </span>
          </div>
        </div>
      </div>
    </section>

    <section style={css({"position":"relative","padding":"clamp(72px,10vw,130px) 24px","background":"#f7f6f4","color":"#111"})}>
      <div style={css({"maxWidth":"1180px","margin":"0 auto"})}>
        <div style={css({"display":"flex","gap":"10px","alignItems":"center","fontSize":"15px","fontWeight":"500","color":"#444"})}>
          <span style={css({"width":"28px","height":"28px","borderRadius":"50%","background":"#111","color":"#fff","display":"grid","placeItems":"center","fontSize":"13px"})}>3</span>
          Tres decisiones, cero aprobaciones indebidas
        </div>
        <h2 style={css({"margin":"22px 0 0","maxWidth":"880px","fontSize":"clamp(34px,4.8vw,64px)","lineHeight":"1.02","letterSpacing":"-.05em","fontWeight":"500","textWrap":"balance"})}>Solo se aprueba lo que las políticas permiten.</h2>
        <p style={css({"margin":"22px 0 0","maxWidth":"720px","fontSize":"clamp(17px,1.7vw,21px)","lineHeight":"1.45","letterSpacing":"-.015em","color":"#6b6866","textWrap":"pretty"})}>
          Cuando un dato es desconocido o ambiguo, la respuesta nunca es «aprobada». Es «requiere aprobación» o «bloqueada».
        </p>
        <div style={css({"marginTop":"56px","display":"grid","gridTemplateColumns":"repeat(auto-fit,minmax(260px,1fr))","gap":"16px"})}>
          <div style={css({"borderRadius":"24px","background":"#e6f6ee","padding":"30px 28px 34px","display":"flex","flexDirection":"column","gap":"18px","minHeight":"260px"})}>
            <span style={css({"width":"48px","height":"48px","borderRadius":"50%","background":"#1e9e6a","display":"grid","placeItems":"center","color":"#fff"})}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l4.5 4.5L19 7" />
              </svg>
            </span>
            <h3 style={css({"margin":"8px 0 0","fontSize":"28px","fontWeight":"500","letterSpacing":"-.035em"})}>Aprobada</h3>
            <p style={css({"margin":"0","fontSize":"17px","lineHeight":"1.5","color":"#3c3a38"})}>
              Cumple todas las reglas y existe una autorización explícita. Queda aprobada para pago.
            </p>
          </div>
          <div style={css({"borderRadius":"24px","background":"#fff3de","padding":"30px 28px 34px","display":"flex","flexDirection":"column","gap":"18px","minHeight":"260px"})}>
            <span style={css({"width":"48px","height":"48px","borderRadius":"50%","background":"#f59a0b","display":"grid","placeItems":"center","color":"#fff"})}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 7v6M12 17v.5" />
              </svg>
            </span>
            <h3 style={css({"margin":"8px 0 0","fontSize":"28px","fontWeight":"500","letterSpacing":"-.035em"})}>Requiere aprobación</h3>
            <p style={css({"margin":"0","fontSize":"17px","lineHeight":"1.5","color":"#3c3a38"})}>
              Hay una excepción que una persona puede autorizar: un contrato que no coincide, una cuenta de pago distinta, un proveedor nuevo o datos incompletos.
            </p>
          </div>
          <div style={css({"borderRadius":"24px","background":"#fde6ec","padding":"30px 28px 34px","display":"flex","flexDirection":"column","gap":"18px","minHeight":"260px"})}>
            <span style={css({"width":"48px","height":"48px","borderRadius":"50%","background":"#f0285a","display":"grid","placeItems":"center","color":"#fff"})}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </span>
            <h3 style={css({"margin":"8px 0 0","fontSize":"28px","fontWeight":"500","letterSpacing":"-.035em"})}>Bloqueada</h3>
            <p style={css({"margin":"0","fontSize":"17px","lineHeight":"1.5","color":"#3c3a38"})}>
              Incumple una restricción absoluta: factura duplicada, proveedor no autorizado o presupuesto agotado.
            </p>
          </div>
        </div>
        <div style={css({"marginTop":"44px"})}>
          <div style={css({"fontSize":"15px","color":"#6b6866","marginBottom":"14px"})}>Casos que Pacta no deja pasar</div>
          <div style={css({"display":"flex","flexWrap":"wrap","gap":"10px"})}>
            <span style={css({"padding":"10px 16px","borderRadius":"99px","background":"#fff","boxShadow":"0 1px 2px rgba(0,0,0,.06)","fontSize":"16px"})}>Factura duplicada</span>
            <span style={css({"padding":"10px 16px","borderRadius":"99px","background":"#fff","boxShadow":"0 1px 2px rgba(0,0,0,.06)","fontSize":"16px"})}>Proveedor nuevo</span>
            <span style={css({"padding":"10px 16px","borderRadius":"99px","background":"#fff","boxShadow":"0 1px 2px rgba(0,0,0,.06)","fontSize":"16px"})}>Factura sin contrato</span>
            <span style={css({"padding":"10px 16px","borderRadius":"99px","background":"#fff","boxShadow":"0 1px 2px rgba(0,0,0,.06)","fontSize":"16px"})}>Recurrencia no autorizada</span>
            <span style={css({"padding":"10px 16px","borderRadius":"99px","background":"#fff","boxShadow":"0 1px 2px rgba(0,0,0,.06)","fontSize":"16px"})}>Monto superior al límite</span>
            <span style={css({"padding":"10px 16px","borderRadius":"99px","background":"#fff","boxShadow":"0 1px 2px rgba(0,0,0,.06)","fontSize":"16px"})}>Presupuesto agotado</span>
            <span style={css({"padding":"10px 16px","borderRadius":"99px","background":"#fff","boxShadow":"0 1px 2px rgba(0,0,0,.06)","fontSize":"16px"})}>Campos incompletos</span>
            <span style={css({"padding":"10px 16px","borderRadius":"99px","background":"#fff","boxShadow":"0 1px 2px rgba(0,0,0,.06)","fontSize":"16px"})}>Cambio de cuenta beneficiaria</span>
            <span style={css({"padding":"10px 16px","borderRadius":"99px","background":"#fff","boxShadow":"0 1px 2px rgba(0,0,0,.06)","fontSize":"16px"})}>Aprobaciones simultáneas</span>
          </div>
        </div>
      </div>
    </section>

    <section style={css({"position":"relative","padding":"clamp(72px,10vw,130px) 24px","background":"#fff","color":"#111"})}>
      <div style={css({"maxWidth":"1180px","margin":"0 auto"})}>
        <div style={css({"display":"grid","gridTemplateColumns":"repeat(auto-fit,minmax(min(100%,380px),1fr))","gap":"56px","alignItems":"center"})}>
          <div>
            <div style={css({"display":"flex","gap":"10px","alignItems":"center","fontSize":"15px","fontWeight":"500","color":"#444"})}>
              <span style={css({"width":"28px","height":"28px","borderRadius":"50%","background":"#111","color":"#fff","display":"grid","placeItems":"center","fontSize":"13px"})}>4</span>
              Cada decisión se puede explicar
            </div>
            <h2 style={css({"margin":"22px 0 0","maxWidth":"880px","fontSize":"clamp(34px,4.8vw,64px)","lineHeight":"1.02","letterSpacing":"-.05em","fontWeight":"500","textWrap":"balance"})}>No es una caja negra: cada decisión muestra por qué.</h2>
            <p style={css({"margin":"22px 0 0","maxWidth":"720px","fontSize":"clamp(17px,1.7vw,21px)","lineHeight":"1.45","letterSpacing":"-.015em","color":"#6b6866","textWrap":"pretty"})}>
              Para cada factura, Pacta muestra las reglas que evaluó y su resultado, los datos que usó, de dónde salieron y el motivo en lenguaje claro. Nada se sobrescribe: si una decisión cambia, queda el registro de la anterior, quién la tomó y cuándo.
            </p>
          </div>
          <div style={css({"background":"#fff","borderRadius":"22px","boxShadow":"0 1px 3px rgba(0,0,0,.05),0 14px 40px rgba(60,30,10,.07)","padding":"28px","border":"1px solid #eee"})}>
            <div style={css({"display":"flex","justifyContent":"space-between","alignItems":"flex-start","gap":"12px","flexWrap":"wrap"})}>
              <div>
                <div style={css({"fontSize":"22px","fontWeight":"500","letterSpacing":"-.03em"})}>Nube Hosting</div>
                <div style={css({"fontSize":"14px","color":"#6b6866","marginTop":"4px"})}>Datos de demostración</div>
              </div>
              <span style={css({"display":"inline-block","padding":"5px 12px","borderRadius":"99px","background":"#fff3de","color":"#7a4a00","fontSize":"14px","fontWeight":"500"})}>Requiere aprobación</span>
            </div>
            <div style={css({"marginTop":"22px","display":"grid","gridTemplateColumns":"1fr 1fr","gap":"12px"})}>
              <div style={css({"background":"#f7f6f4","borderRadius":"14px","padding":"14px 16px"})}>
                <div style={css({"fontSize":"13px","color":"#6b6866"})}>Factura</div>
                <div style={css({"fontSize":"26px","fontWeight":"500","letterSpacing":"-.03em"})}>$1.600</div>
              </div>
              <div style={css({"background":"#f7f6f4","borderRadius":"14px","padding":"14px 16px"})}>
                <div style={css({"fontSize":"13px","color":"#6b6866"})}>Contrato</div>
                <div style={css({"fontSize":"26px","fontWeight":"500","letterSpacing":"-.03em"})}>$1.500</div>
              </div>
            </div>
            <div style={css({"marginTop":"22px","fontSize":"13px","color":"#6b6866","letterSpacing":".04em","textTransform":"uppercase"})}>Reglas evaluadas</div>
            <div style={css({"marginTop":"8px"})}>
              <div style={css({"display":"flex","alignItems":"center","gap":"12px","padding":"11px 0","borderBottom":"1px solid #f0eeec","fontSize":"16px"})}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e9e6a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l4.5 4.5L19 7" />
                </svg>
                <span style={css({"flex":"1"})}>Proveedor reconocido</span>
              </div>
              <div style={css({"display":"flex","alignItems":"center","gap":"12px","padding":"11px 0","borderBottom":"1px solid #f0eeec","fontSize":"16px"})}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e9e6a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l4.5 4.5L19 7" />
                </svg>
                <span style={css({"flex":"1"})}>Factura no duplicada</span>
              </div>
              <div style={css({"display":"flex","alignItems":"center","gap":"12px","padding":"11px 0","borderBottom":"1px solid #f0eeec","fontSize":"16px"})}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e9e6a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l4.5 4.5L19 7" />
                </svg>
                <span style={css({"flex":"1"})}>Presupuesto disponible</span>
              </div>
              <div style={css({"display":"flex","alignItems":"center","gap":"12px","padding":"11px 0","borderBottom":"1px solid #f0eeec","fontSize":"16px","fontWeight":"500"})}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f0285a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
                <span style={css({"flex":"1"})}>Monto igual al del contrato</span>
              </div>
              <div style={css({"display":"flex","alignItems":"center","gap":"12px","padding":"11px 0","borderBottom":"1px solid #f0eeec","fontSize":"16px"})}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e9e6a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l4.5 4.5L19 7" />
                </svg>
                <span style={css({"flex":"1"})}>Cuenta beneficiaria coincide</span>
              </div>
            </div>
            <div style={css({"marginTop":"20px","padding":"16px","borderRadius":"14px","background":"#fff3de","fontSize":"16px","lineHeight":"1.45"})}>
              <b style={css({"fontWeight":"500"})}>Motivo.</b>
              El monto de la factura difiere del acordado en el contrato.
            </div>
            <div style={css({"marginTop":"16px","display":"flex","flexWrap":"wrap","gap":"8px","alignItems":"center","fontSize":"14px","color":"#6b6866"})}>
              Evidencia:
              <span style={css({"padding":"5px 11px","borderRadius":"8px","background":"#f1efec","color":"#222"})}>Factura (PDF)</span>
              <span style={css({"padding":"5px 11px","borderRadius":"8px","background":"#f1efec","color":"#222"})}>Contrato vigente</span>
              <span style={css({"padding":"5px 11px","borderRadius":"8px","background":"#f1efec","color":"#222"})}>Historial de pagos</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section style={css({"position":"relative","padding":"clamp(72px,10vw,130px) 24px","background":"#0b2f2c","color":"#fff"})}>
      <div style={css({"maxWidth":"1180px","margin":"0 auto"})}>
        <div style={css({"display":"flex","gap":"10px","alignItems":"center","fontSize":"15px","fontWeight":"500","color":"rgba(255,255,255,.75)"})}>
          <span style={css({"width":"28px","height":"28px","borderRadius":"50%","background":"#fff","color":"#111","display":"grid","placeItems":"center","fontSize":"13px"})}>5</span>
          La IA lee; el motor decide
        </div>
        <h2 style={css({"margin":"22px 0 0","maxWidth":"880px","fontSize":"clamp(34px,4.8vw,64px)","lineHeight":"1.02","letterSpacing":"-.05em","fontWeight":"500","textWrap":"balance"})}>La IA propone datos. Nunca aprueba un pago.</h2>
        <p style={css({"margin":"22px 0 0","maxWidth":"720px","fontSize":"clamp(17px,1.7vw,21px)","lineHeight":"1.45","letterSpacing":"-.015em","color":"rgba(255,255,255,.72)","textWrap":"pretty"})}>
          Los correos, PDF, imágenes, contratos y las salidas del modelo se tratan como datos no confiables. Si un documento trae instrucciones escondidas, se ignoran. El modelo solo interpreta y propone; la decisión final sale de un motor determinista que aplica las políticas de la empresa.
        </p>
        <div style={css({"marginTop":"64px","display":"flex","alignItems":"stretch","gap":"14px","flexWrap":"wrap"})}>
          <div style={css({"flex":"1 1 150px","minWidth":"140px","padding":"22px 20px","borderRadius":"20px","background":"rgba(255,255,255,.07)","color":"#fff","border":"1px solid rgba(255,255,255,.14)"})}>
            <div style={css({"fontSize":"20px","fontWeight":"500","letterSpacing":"-.025em"})}>Documento</div>
            <div style={css({"marginTop":"6px","fontSize":"14px","opacity":".7"})}>Correo, PDF, imagen</div>
          </div>
          <span style={css({"flex":"none","color":"rgba(255,255,255,.5)"})}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </span>
          <div style={css({"flex":"1 1 150px","minWidth":"140px","padding":"22px 20px","borderRadius":"20px","background":"rgba(255,255,255,.07)","color":"#fff","border":"1px solid rgba(255,255,255,.14)"})}>
            <div style={css({"fontSize":"20px","fontWeight":"500","letterSpacing":"-.025em"})}>IA extrae</div>
            <div style={css({"marginTop":"6px","fontSize":"14px","opacity":".7"})}>Interpreta y propone</div>
          </div>
          <div style={css({"flex":"none","display":"flex","flexDirection":"column","alignItems":"center","gap":"10px","justifyContent":"center","padding":"0 8px"})}>
            <span style={css({"fontSize":"13px","letterSpacing":".06em","textTransform":"uppercase","color":"#f6a27e","whiteSpace":"nowrap"})}>La IA no cruza</span>
            <div style={css({"width":"14px","flex":"1","minHeight":"90px","borderRadius":"4px","background":"repeating-linear-gradient(135deg,#e63e10 0 6px,#0b2f2c 6px 12px)"})} />
          </div>
          <div style={css({"flex":"1 1 150px","minWidth":"140px","padding":"22px 20px","borderRadius":"20px","background":"rgba(255,255,255,.07)","color":"#fff","border":"1px solid rgba(255,255,255,.14)"})}>
            <div style={css({"fontSize":"20px","fontWeight":"500","letterSpacing":"-.025em"})}>Validación estricta</div>
            <div style={css({"marginTop":"6px","fontSize":"14px","opacity":".7"})}>Esquema rígido; lo faltante queda «desconocido»</div>
          </div>
          <span style={css({"flex":"none","color":"rgba(255,255,255,.5)"})}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </span>
          <div style={css({"flex":"1 1 150px","minWidth":"140px","padding":"22px 20px","borderRadius":"20px","background":"#fff","color":"#111","border":"1px solid rgba(255,255,255,.14)"})}>
            <div style={css({"fontSize":"20px","fontWeight":"500","letterSpacing":"-.025em"})}>Motor decide</div>
            <div style={css({"marginTop":"6px","fontSize":"14px","opacity":".7"})}>Reglas deterministas</div>
          </div>
        </div>
        <div style={css({"marginTop":"36px","display":"grid","gridTemplateColumns":"repeat(auto-fit,minmax(240px,1fr))","gap":"14px"})}>
          <div style={css({"padding":"22px","borderRadius":"18px","background":"rgba(255,255,255,.06)"})}>
            <div style={css({"fontSize":"18px","fontWeight":"500"})}>Datos no confiables</div>
            <div style={css({"marginTop":"6px","fontSize":"16px","lineHeight":"1.45","color":"rgba(255,255,255,.7)"})}>
              Todo lo que llega, y lo que produce el modelo, se trata como entrada sin autoridad.
            </div>
          </div>
          <div style={css({"padding":"22px","borderRadius":"18px","background":"rgba(255,255,255,.06)"})}>
            <div style={css({"fontSize":"18px","fontWeight":"500"})}>Instrucciones escondidas</div>
            <div style={css({"marginTop":"6px","fontSize":"16px","lineHeight":"1.45","color":"rgba(255,255,255,.7)"})}>Si un documento las trae, se ignoran.</div>
          </div>
          <div style={css({"padding":"22px","borderRadius":"18px","background":"rgba(255,255,255,.06)"})}>
            <div style={css({"fontSize":"18px","fontWeight":"500"})}>Autoridad</div>
            <div style={css({"marginTop":"6px","fontSize":"16px","lineHeight":"1.45","color":"rgba(255,255,255,.7)"})}>Solo el motor, con las políticas de la empresa.</div>
          </div>
        </div>
      </div>
    </section>

    <section style={css({"position":"relative","padding":"clamp(72px,10vw,130px) 24px","background":"#f7f6f4","color":"#111"})}>
      <div style={css({"maxWidth":"1180px","margin":"0 auto"})}>
        <div style={css({"display":"flex","gap":"10px","alignItems":"center","fontSize":"15px","fontWeight":"500","color":"#444"})}>
          <span style={css({"width":"28px","height":"28px","borderRadius":"50%","background":"#111","color":"#fff","display":"grid","placeItems":"center","fontSize":"13px"})}>6</span>
          Los contratos son flujos
        </div>
        <h2 style={css({"margin":"22px 0 0","maxWidth":"880px","fontSize":"clamp(34px,4.8vw,64px)","lineHeight":"1.02","letterSpacing":"-.05em","fontWeight":"500","textWrap":"balance"})}>Un contrato es un flujo que define cómo se paga.</h2>
        <p style={css({"margin":"22px 0 0","maxWidth":"720px","fontSize":"clamp(17px,1.7vw,21px)","lineHeight":"1.45","letterSpacing":"-.015em","color":"#6b6866","textWrap":"pretty"})}>
          En Pacta cada contrato se arma en un lienzo de nodos conectados: vigencia, monto, cuenta beneficiaria, condiciones, hitos de entrega y plazos de pago. Las facturas se comparan con el flujo activo y cualquier diferencia se escala.
        </p>
        <div style={css({"marginTop":"56px","display":"grid","gridTemplateColumns":"repeat(auto-fit,minmax(min(100%,420px),1fr))","gap":"24px","alignItems":"start"})}>
          <div style={css({"background":"#fff","borderRadius":"22px","boxShadow":"0 1px 3px rgba(0,0,0,.05),0 14px 40px rgba(60,30,10,.07)","padding":"14px","overflow":"hidden"})}>
            <div style={css({"display":"flex","gap":"8px","alignItems":"center","flexWrap":"wrap","padding":"6px 8px 14px","fontSize":"14px"})}>
              <span style={css({"padding":"6px 12px","borderRadius":"99px","background":"#111","color":"#fff"})}>Versión activa · congelada</span>
              <span style={css({"padding":"6px 12px","borderRadius":"99px","background":"#f1efec"})}>Borrador</span>
              <span style={css({"marginLeft":"auto","display":"flex","alignItems":"center","gap":"6px","color":"#1e9e6a"})}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e9e6a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l4.5 4.5L19 7" />
                </svg>
                Validación en vivo
              </span>
            </div>
            <div style={css({"overflowX":"auto","borderRadius":"14px","background":"#faf9f8"})}>
              <svg viewBox="0 0 900 400" style={css({"display":"block","minWidth":"620px","width":"100%"})}>
                <defs>
                  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
                    <circle cx="2" cy="2" r="1.2" fill="#d9d5d0" />
                  </pattern>
                </defs>
                <rect width="900" height="400" fill="url(#dots)" />
                <path d="M200 72 C260 72 190 136 250 136" fill="none" stroke="#cfcbc6" strokeWidth="2" />
                <path d="M200 200 C260 200 190 136 250 136" fill="none" stroke="#e63e10" strokeWidth="3" strokeDasharray="8 6" style={css({"animation":"pacta-land-dash 1.2s linear infinite"})} />
                <path d="M200 200 C260 200 190 264 250 264" fill="none" stroke="#cfcbc6" strokeWidth="2" />
                <path d="M200 328 C260 328 190 264 250 264" fill="none" stroke="#cfcbc6" strokeWidth="2" />
                <path d="M420 136 C480 136 410 200 470 200" fill="none" stroke="#e63e10" strokeWidth="3" strokeDasharray="8 6" style={css({"animation":"pacta-land-dash 1.2s linear infinite"})} />
                <path d="M420 264 C480 264 410 200 470 200" fill="none" stroke="#cfcbc6" strokeWidth="2" />
                <path d="M640 200 C700 200 640 200 700 200" fill="none" stroke="#e63e10" strokeWidth="3" strokeDasharray="8 6" style={css({"animation":"pacta-land-dash 1.2s linear infinite"})} />
                <g>
                  <rect x="30" y="40" width="170" height="64" rx="14" fill="#fff" stroke="#dedad5" strokeWidth="1.5" />
                  <text x="46" y="68" fontSize="15" fontWeight="600" fill="#111">Vigencia</text>
                  <text x="46" y="87" fontSize="12" fill="#6b6866">inicio y fin</text>
                </g>
                <g>
                  <rect x="30" y="168" width="170" height="64" rx="14" fill="#fff" stroke="#f0285a" strokeWidth="2.5" />
                  <text x="46" y="196" fontSize="15" fontWeight="600" fill="#111">Monto</text>
                  <text x="46" y="215" fontSize="12" fill="#6b6866">$1.500</text>
                </g>
                <g>
                  <rect x="30" y="296" width="170" height="64" rx="14" fill="#fff" stroke="#dedad5" strokeWidth="1.5" />
                  <text x="46" y="324" fontSize="15" fontWeight="600" fill="#111">Cuenta beneficiaria</text>
                  <text x="46" y="343" fontSize="12" fill="#6b6866">cuenta registrada</text>
                </g>
                <g>
                  <rect x="250" y="104" width="170" height="64" rx="14" fill="#fff" stroke="#e63e10" strokeWidth="2.5" />
                  <text x="266" y="132" fontSize="15" fontWeight="600" fill="#111">Condiciones</text>
                  <text x="266" y="151" fontSize="12" fill="#6b6866">reglas del contrato</text>
                </g>
                <g>
                  <rect x="250" y="232" width="170" height="64" rx="14" fill="#fff" stroke="#dedad5" strokeWidth="1.5" />
                  <text x="266" y="260" fontSize="15" fontWeight="600" fill="#111">Hitos de entrega</text>
                  <text x="266" y="279" fontSize="12" fill="#6b6866">entregas</text>
                </g>
                <g>
                  <rect x="470" y="168" width="170" height="64" rx="14" fill="#fff" stroke="#e63e10" strokeWidth="2.5" />
                  <text x="486" y="196" fontSize="15" fontWeight="600" fill="#111">Plazos de pago</text>
                  <text x="486" y="215" fontSize="12" fill="#6b6866">días de pago</text>
                </g>
                <g>
                  <rect x="700" y="168" width="170" height="64" rx="14" fill="#fff" stroke="#e63e10" strokeWidth="2.5" />
                  <text x="716" y="196" fontSize="15" fontWeight="600" fill="#111">Resultado</text>
                  <text x="716" y="215" fontSize="12" fill="#6b6866">Escala a una persona</text>
                </g>
                <g>
                  <rect x="30" y="140" width="170" height="22" rx="11" fill="#f0285a" />
                  <text x="115" y="155" fontSize="12" fontWeight="600" fill="#fff" textAnchor="middle">Factura $1.600 ≠ $1.500</text>
                </g>
              </svg>
            </div>
            <div style={css({"padding":"12px 8px 4px","fontSize":"14px","color":"#6b6866"})}>
              Simulador: la factura de prueba recorre el flujo (naranja) y se detiene en el monto.
            </div>
          </div>
          <div style={css({"display":"flex","flexDirection":"column","gap":"14px"})}>
            <div style={css({"background":"#fff","borderRadius":"22px","boxShadow":"0 1px 3px rgba(0,0,0,.05),0 14px 40px rgba(60,30,10,.07)","padding":"22px 24px"})}>
              <b style={css({"fontWeight":"500","fontSize":"19px"})}>Validación en vivo</b>
              <span style={css({"fontSize":"17px","color":"#6b6866"})}>— mientras lo armas.</span>
            </div>
            <div style={css({"background":"#fff","borderRadius":"22px","boxShadow":"0 1px 3px rgba(0,0,0,.05),0 14px 40px rgba(60,30,10,.07)","padding":"22px 24px"})}>
              <b style={css({"fontWeight":"500","fontSize":"19px"})}>Versiones</b>
              <span style={css({"fontSize":"17px","color":"#6b6866"})}>— borrador y versión activa; la activa queda congelada.</span>
            </div>
            <div style={css({"background":"#fff","borderRadius":"22px","boxShadow":"0 1px 3px rgba(0,0,0,.05),0 14px 40px rgba(60,30,10,.07)","padding":"22px 24px"})}>
              <b style={css({"fontWeight":"500","fontSize":"19px"})}>Simulador</b>
              <span style={css({"fontSize":"17px","color":"#6b6866"})}>— prueba una factura y mira qué camino recorre y dónde falla.</span>
            </div>
            <div style={css({"padding":"20px 24px","borderRadius":"22px","background":"#111","color":"#fff","fontSize":"18px","lineHeight":"1.4"})}>
              Un contrato es evidencia. No autoriza pagos: solo una autorización explícita lo hace.
            </div>
          </div>
        </div>
      </div>
    </section>

    <section style={css({"position":"relative","padding":"clamp(72px,10vw,130px) 24px","background":"#fff","color":"#111"})}>
      <div style={css({"maxWidth":"1180px","margin":"0 auto"})}>
        <div style={css({"display":"grid","gridTemplateColumns":"repeat(auto-fit,minmax(min(100%,400px),1fr))","gap":"56px","alignItems":"start"})}>
          <div>
            <div style={css({"display":"flex","gap":"10px","alignItems":"center","fontSize":"15px","fontWeight":"500","color":"#444"})}>
              <span style={css({"width":"28px","height":"28px","borderRadius":"50%","background":"#111","color":"#fff","display":"grid","placeItems":"center","fontSize":"13px"})}>7</span>
              Las personas tienen la última palabra
            </div>
            <h2 style={css({"margin":"22px 0 0","maxWidth":"880px","fontSize":"clamp(34px,4.8vw,64px)","lineHeight":"1.02","letterSpacing":"-.05em","fontWeight":"500","textWrap":"balance"})}>Cuando hace falta una persona, Pacta lo pone fácil y seguro.</h2>
            <div style={css({"marginTop":"32px","display":"flex","flexDirection":"column","gap":"16px"})}>
              <div style={css({"display":"flex","gap":"14px","alignItems":"flex-start"})}>
                <span style={css({"flex":"none","marginTop":"2px","width":"26px","height":"26px","borderRadius":"50%","background":"#e6f6ee","display":"grid","placeItems":"center"})}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e9e6a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l4.5 4.5L19 7" />
                  </svg>
                </span>
                <p style={css({"margin":"0","fontSize":"17px","lineHeight":"1.5","color":"#6b6866","textWrap":"pretty"})}>
                  Solo usuarios autenticados y autorizados pueden aprobar, rechazar o cambiar políticas. Enviar un correo no da autoridad para aprobar.
                </p>
              </div>
              <div style={css({"display":"flex","gap":"14px","alignItems":"flex-start"})}>
                <span style={css({"flex":"none","marginTop":"2px","width":"26px","height":"26px","borderRadius":"50%","background":"#e6f6ee","display":"grid","placeItems":"center"})}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e9e6a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l4.5 4.5L19 7" />
                  </svg>
                </span>
                <p style={css({"margin":"0","fontSize":"17px","lineHeight":"1.5","color":"#6b6866","textWrap":"pretty"})}>
                  Antes de confirmar una aprobación, Pacta vuelve a evaluar la factura con la política y el presupuesto vigentes.
                </p>
              </div>
              <div style={css({"display":"flex","gap":"14px","alignItems":"flex-start"})}>
                <span style={css({"flex":"none","marginTop":"2px","width":"26px","height":"26px","borderRadius":"50%","background":"#e6f6ee","display":"grid","placeItems":"center"})}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e9e6a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l4.5 4.5L19 7" />
                  </svg>
                </span>
                <p style={css({"margin":"0","fontSize":"17px","lineHeight":"1.5","color":"#6b6866","textWrap":"pretty"})}>
                  Una aprobación humana no salta las restricciones absolutas, como un duplicado o un presupuesto agotado.
                </p>
              </div>
              <div style={css({"display":"flex","gap":"14px","alignItems":"flex-start"})}>
                <span style={css({"flex":"none","marginTop":"2px","width":"26px","height":"26px","borderRadius":"50%","background":"#e6f6ee","display":"grid","placeItems":"center"})}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e9e6a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l4.5 4.5L19 7" />
                  </svg>
                </span>
                <p style={css({"margin":"0","fontSize":"17px","lineHeight":"1.5","color":"#6b6866","textWrap":"pretty"})}>
                  Un pago recurrente detectado en el historial es solo una sugerencia. Únicamente una persona puede convertirlo en autorización, con límites definidos.
                </p>
              </div>
              <div style={css({"display":"flex","gap":"14px","alignItems":"flex-start"})}>
                <span style={css({"flex":"none","marginTop":"2px","width":"26px","height":"26px","borderRadius":"50%","background":"#e6f6ee","display":"grid","placeItems":"center"})}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e9e6a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l4.5 4.5L19 7" />
                  </svg>
                </span>
                <p style={css({"margin":"0","fontSize":"17px","lineHeight":"1.5","color":"#6b6866","textWrap":"pretty"})}>Las aprobaciones simultáneas se protegen para evitar el doble gasto.</p>
              </div>
            </div>
          </div>
          <div style={css({"borderRadius":"28px","background":"#f7f6f4","padding":"22px"})}>
            <div style={css({"display":"flex","alignItems":"center","justifyContent":"space-between","padding":"4px 6px 16px","fontSize":"18px","fontWeight":"500"})}>
              Aprobaciones pendientes
              <span style={css({"fontSize":"13px","background":"#fff","padding":"4px 10px","borderRadius":"99px","color":"#6b6866"})}>Demostración</span>
            </div>
            <div style={css({"background":"#fff","borderRadius":"22px","boxShadow":"0 1px 3px rgba(0,0,0,.05),0 14px 40px rgba(60,30,10,.07)","padding":"22px","border":"1.5px solid #e63e10"})}>
              <div style={css({"display":"flex","justifyContent":"space-between","gap":"10px","flexWrap":"wrap"})}>
                <b style={css({"fontWeight":"500","fontSize":"20px","letterSpacing":"-.02em"})}>Autorizar recurrencia</b>
                <span style={css({"display":"inline-block","padding":"5px 12px","borderRadius":"99px","background":"#fff3de","color":"#7a4a00","fontSize":"14px","fontWeight":"500"})}>Sugerencia del historial</span>
              </div>
              <p style={css({"margin":"10px 0 16px","fontSize":"16px","lineHeight":"1.45","color":"#6b6866"})}>
                Se detectó un pago recurrente. No es una autorización hasta que una persona la confirme con límites.
              </p>
              <div style={css({"display":"grid","gridTemplateColumns":"1fr 1fr","gap":"10px"})}>
                <div style={css({"padding":"12px 14px","borderRadius":"12px","background":"#f7f6f4"})}>
                  <div style={css({"fontSize":"12px","color":"#6b6866"})}>Monto máximo</div>
                  <div style={css({"fontSize":"17px","fontWeight":"500"})}>Definir límite</div>
                </div>
                <div style={css({"padding":"12px 14px","borderRadius":"12px","background":"#f7f6f4"})}>
                  <div style={css({"fontSize":"12px","color":"#6b6866"})}>Vigencia</div>
                  <div style={css({"fontSize":"17px","fontWeight":"500"})}>Definir periodo</div>
                </div>
              </div>
              <div style={css({"marginTop":"16px","display":"flex","gap":"10px"})}>
                <span style={css({"padding":"12px 22px","borderRadius":"99px","background":"#111","color":"#fff","fontSize":"16px","fontWeight":"500"})}>Autorizar</span>
                <span style={css({"padding":"12px 22px","borderRadius":"99px","background":"#f1efec","fontSize":"16px"})}>Rechazar</span>
              </div>
            </div>
            <div style={css({"marginTop":"10px","background":"#fff","borderRadius":"22px","boxShadow":"0 1px 3px rgba(0,0,0,.05),0 14px 40px rgba(60,30,10,.07)","padding":"16px 20px","display":"flex","justifyContent":"space-between","gap":"10px","fontSize":"16px","flexWrap":"wrap"})}>
              <span>Nube Hosting · $1.600</span>
              <span style={css({"color":"#b36a00"})}>Requiere aprobación</span>
            </div>
            <div style={css({"marginTop":"10px","background":"#fff","borderRadius":"22px","boxShadow":"0 1px 3px rgba(0,0,0,.05),0 14px 40px rgba(60,30,10,.07)","padding":"16px 20px","display":"flex","justifyContent":"space-between","gap":"10px","fontSize":"16px","flexWrap":"wrap"})}>
              <span>Proveedor nuevo</span>
              <span style={css({"color":"#b36a00"})}>Requiere aprobación</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section style={css({"position":"relative","padding":"clamp(72px,10vw,130px) 24px","background":"#f7f6f4","color":"#111"})}>
      <div style={css({"maxWidth":"1180px","margin":"0 auto"})}>
        <div style={css({"display":"flex","gap":"10px","alignItems":"center","fontSize":"15px","fontWeight":"500","color":"#444"})}>
          <span style={css({"width":"28px","height":"28px","borderRadius":"50%","background":"#111","color":"#fff","display":"grid","placeItems":"center","fontSize":"13px"})}>8</span>
          Pacta no espera a la factura
        </div>
        <h2 style={css({"margin":"22px 0 0","maxWidth":"880px","fontSize":"clamp(34px,4.8vw,64px)","lineHeight":"1.02","letterSpacing":"-.05em","fontWeight":"500","textWrap":"balance"})}>Nómina e impuestos, vigilados antes del vencimiento.</h2>
        <p style={css({"margin":"22px 0 0","maxWidth":"720px","fontSize":"clamp(17px,1.7vw,21px)","lineHeight":"1.45","letterSpacing":"-.015em","color":"#6b6866","textWrap":"pretty"})}>
          Pacta conoce las obligaciones recurrentes de la empresa, reúne la evidencia por su cuenta y valida cada pago antes de soltarlo. Una plantilla solo opera cuando una persona autorizada la activa, con sus límites.
        </p>
        <div style={css({"marginTop":"56px","display":"grid","gridTemplateColumns":"repeat(auto-fit,minmax(min(100%,460px),1fr))","gap":"20px","alignItems":"start"})}>
          <div style={css({"background":"#fff","borderRadius":"22px","boxShadow":"0 1px 3px rgba(0,0,0,.05),0 14px 40px rgba(60,30,10,.07)","padding":"30px"})}>
            <h3 style={css({"margin":"0","fontSize":"30px","fontWeight":"500","letterSpacing":"-.04em"})}>Nómina</h3>
            <p style={css({"margin":"10px 0 0","fontSize":"16px","lineHeight":"1.45","color":"#6b6866"})}>Sigue su propio calendario, con una nueva validación justo antes de pagar.</p>
            <div style={css({"marginTop":"26px","display":"grid","gridTemplateColumns":"repeat(4,1fr)","gap":"6px"})}>
              <div>
                <div style={css({"display":"flex","alignItems":"center"})}>
                  <span style={css({"flex":"none","width":"16px","height":"16px","borderRadius":"50%","background":"#111"})} />
                  <span style={css({"flex":"1","height":"2px","background":"#d9d5d0"})} />
                </div>
                <div style={css({"marginTop":"10px","fontSize":"14px","lineHeight":"1.3","paddingRight":"6px"})}>Preparar la corrida</div>
              </div>
              <div>
                <div style={css({"display":"flex","alignItems":"center"})}>
                  <span style={css({"flex":"none","width":"16px","height":"16px","borderRadius":"50%","background":"#111"})} />
                  <span style={css({"flex":"1","height":"2px","background":"#d9d5d0"})} />
                </div>
                <div style={css({"marginTop":"10px","fontSize":"14px","lineHeight":"1.3","paddingRight":"6px"})}>Aviso temprano</div>
              </div>
              <div>
                <div style={css({"display":"flex","alignItems":"center"})}>
                  <span style={css({"flex":"none","width":"16px","height":"16px","borderRadius":"50%","background":"#111"})} />
                  <span style={css({"flex":"1","height":"2px","background":"#d9d5d0"})} />
                </div>
                <div style={css({"marginTop":"10px","fontSize":"14px","lineHeight":"1.3","paddingRight":"6px"})}>Aviso urgente</div>
              </div>
              <div>
                <div style={css({"display":"flex","alignItems":"center"})}>
                  <span style={css({"flex":"none","width":"16px","height":"16px","borderRadius":"50%","background":"#e63e10"})} />
                  <span style={css({"flex":"1","height":"2px","background":"transparent"})} />
                </div>
                <div style={css({"marginTop":"10px","fontSize":"14px","lineHeight":"1.3","paddingRight":"6px"})}>Pagar el día del vencimiento</div>
              </div>
            </div>
            <div style={css({"marginTop":"28px","fontSize":"13px","color":"#6b6866","letterSpacing":".04em","textTransform":"uppercase"})}>Corrida de 12 líneas · demostración</div>
            <div style={css({"marginTop":"8px"})}>
              <div style={css({"display":"grid","gridTemplateColumns":"1fr 1.3fr auto","gap":"10px","alignItems":"center","padding":"12px 0","borderBottom":"1px solid #f0eeec","fontSize":"15px"})}>
                <span style={css({"fontWeight":"500"})}>Líneas 1 a 9</span>
                <span style={css({"color":"#6b6866"})}>Cumplen las reglas</span>
                <span style={css({"padding":"4px 10px","borderRadius":"99px","background":"#e6f6ee","whiteSpace":"nowrap","fontSize":"13px"})}>Aprobadas ×9</span>
              </div>
              <div style={css({"display":"grid","gridTemplateColumns":"1fr 1.3fr auto","gap":"10px","alignItems":"center","padding":"12px 0","borderBottom":"1px solid #f0eeec","fontSize":"15px"})}>
                <span style={css({"fontWeight":"500"})}>Línea 10</span>
                <span style={css({"color":"#6b6866"})}>Empleado retirado</span>
                <span style={css({"padding":"4px 10px","borderRadius":"99px","background":"#fde6ec","whiteSpace":"nowrap","fontSize":"13px"})}>Bloqueada</span>
              </div>
              <div style={css({"display":"grid","gridTemplateColumns":"1fr 1.3fr auto","gap":"10px","alignItems":"center","padding":"12px 0","borderBottom":"1px solid #f0eeec","fontSize":"15px"})}>
                <span style={css({"fontWeight":"500"})}>Línea 11</span>
                <span style={css({"color":"#6b6866"})}>Cuenta cambiada</span>
                <span style={css({"padding":"4px 10px","borderRadius":"99px","background":"#fff3de","whiteSpace":"nowrap","fontSize":"13px"})}>Requiere aprobación</span>
              </div>
              <div style={css({"display":"grid","gridTemplateColumns":"1fr 1.3fr auto","gap":"10px","alignItems":"center","padding":"12px 0","borderBottom":"1px solid #f0eeec","fontSize":"15px"})}>
                <span style={css({"fontWeight":"500"})}>Línea 12</span>
                <span style={css({"color":"#6b6866"})}>Variación del salario</span>
                <span style={css({"padding":"4px 10px","borderRadius":"99px","background":"#fff3de","whiteSpace":"nowrap","fontSize":"13px"})}>Requiere aprobación</span>
              </div>
            </div>
            <ul style={css({"margin":"22px 0 0","padding":"0","listStyle":"none","display":"grid","gap":"10px"})}>
              <li style={css({"display":"flex","gap":"10px","fontSize":"16px","lineHeight":"1.45","color":"#3c3a38"})}>
                <span style={css({"flex":"none","marginTop":"9px","width":"6px","height":"6px","borderRadius":"50%","background":"#111"})} />
                <span>Cada línea se decide por separado.</span>
              </li>
              <li style={css({"display":"flex","gap":"10px","fontSize":"16px","lineHeight":"1.45","color":"#3c3a38"})}>
                <span style={css({"flex":"none","marginTop":"9px","width":"6px","height":"6px","borderRadius":"50%","background":"#111"})} />
                <span>
                  Si llega una novedad, como un retiro, la corrida se reevalúa y una línea ya aprobada puede volver a «requiere aprobación».
                </span>
              </li>
              <li style={css({"display":"flex","gap":"10px","fontSize":"16px","lineHeight":"1.45","color":"#3c3a38"})}>
                <span style={css({"flex":"none","marginTop":"9px","width":"6px","height":"6px","borderRadius":"50%","background":"#111"})} />
                <span>Un cambio de cuenta de pago nunca se aprueba solo.</span>
              </li>
            </ul>
          </div>
          <div style={css({"background":"#fff","borderRadius":"22px","boxShadow":"0 1px 3px rgba(0,0,0,.05),0 14px 40px rgba(60,30,10,.07)","padding":"30px"})}>
            <h3 style={css({"margin":"0","fontSize":"30px","fontWeight":"500","letterSpacing":"-.04em"})}>Impuestos</h3>
            <p style={css({"margin":"10px 0 0","fontSize":"16px","lineHeight":"1.45","color":"#6b6866"})}>
              Pacta no calcula impuestos. Compara el borrador de la contabilidad con la liquidación que confirma una persona.
            </p>
            <div style={css({"marginTop":"26px","display":"grid","gridTemplateColumns":"1fr auto 1fr","gap":"12px","alignItems":"center"})}>
              <div style={css({"padding":"16px","borderRadius":"14px","background":"#f7f6f4"})}>
                <div style={css({"fontSize":"12px","color":"#6b6866"})}>Contabilidad</div>
                <div style={css({"fontSize":"17px","fontWeight":"500"})}>Borrador</div>
              </div>
              <span style={css({"color":"#6b6866"})}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 8h11l-3-3M17 16H6l3 3" />
                </svg>
              </span>
              <div style={css({"padding":"16px","borderRadius":"14px","background":"#f7f6f4"})}>
                <div style={css({"fontSize":"12px","color":"#6b6866"})}>Persona</div>
                <div style={css({"fontSize":"17px","fontWeight":"500"})}>Liquidación confirmada</div>
              </div>
            </div>
            <div style={css({"marginTop":"22px","display":"flex","flexWrap":"wrap","gap":"8px"})}>
              <span style={css({"padding":"8px 14px","borderRadius":"99px","background":"#f1efec","fontSize":"15px"})}>IVA</span>
              <span style={css({"padding":"8px 14px","borderRadius":"99px","background":"#f1efec","fontSize":"15px"})}>Retención en la fuente</span>
              <span style={css({"padding":"8px 14px","borderRadius":"99px","background":"#f1efec","fontSize":"15px"})}>ICA</span>
              <span style={css({"padding":"8px 14px","borderRadius":"99px","background":"#f1efec","fontSize":"15px"})}>Seguridad social</span>
              <span style={css({"padding":"8px 14px","borderRadius":"99px","background":"#f1efec","fontSize":"15px"})}>Parafiscales</span>
            </div>
            <div style={css({"marginTop":"22px","display":"flex","gap":"10px"})}>
              <span style={css({"padding":"10px 16px","borderRadius":"14px","background":"#fff3de","fontSize":"15px"})}>
                <b style={css({"fontWeight":"500"})}>7 días</b>
                antes
              </span>
              <span style={css({"padding":"10px 16px","borderRadius":"14px","background":"#fde6ec","fontSize":"15px"})}>
                <b style={css({"fontWeight":"500"})}>3 días</b>
                antes
              </span>
            </div>
            <div style={css({"marginTop":"22px","padding":"18px","borderRadius":"14px","background":"#111","color":"#fff","fontSize":"16px","lineHeight":"1.45"})}>
              Regla de provisión: «reservar X % de los ingresos para impuestos». Puede escalar un pago, pero nunca fija el monto a pagar.
            </div>
          </div>
        </div>
      </div>
    </section>

    <section style={css({"position":"relative","padding":"clamp(72px,10vw,130px) 24px","background":"#0b2f2c","color":"#fff"})}>
      <div style={css({"maxWidth":"1180px","margin":"0 auto"})}>
        <div style={css({"display":"flex","gap":"10px","alignItems":"center","fontSize":"15px","fontWeight":"500","color":"rgba(255,255,255,.75)"})}>
          <span style={css({"width":"28px","height":"28px","borderRadius":"50%","background":"#fff","color":"#111","display":"grid","placeItems":"center","fontSize":"13px"})}>9</span>
          Seguridad por diseño
        </div>
        <h2 style={css({"margin":"22px 0 0","maxWidth":"880px","fontSize":"clamp(34px,4.8vw,64px)","lineHeight":"1.02","letterSpacing":"-.05em","fontWeight":"500","textWrap":"balance"})}>Los límites están en el código, no en la confianza.</h2>
        <div style={css({"marginTop":"56px","display":"grid","gridTemplateColumns":"repeat(auto-fit,minmax(280px,1fr))","gap":"14px"})}>
          <div style={css({"padding":"28px","borderRadius":"22px","background":"rgba(255,255,255,.06)","border":"1px solid rgba(255,255,255,.1)"})}>
            <span style={css({"color":"#f6a27e"})}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M6 6l12 12" />
              </svg>
            </span>
            <div style={css({"marginTop":"20px","fontSize":"22px","fontWeight":"500","letterSpacing":"-.025em"})}>La IA no es autoridad</div>
            <div style={css({"marginTop":"8px","fontSize":"16px","lineHeight":"1.5","color":"rgba(255,255,255,.7)"})}>El modelo de IA nunca es autoridad de aprobación.</div>
          </div>
          <div style={css({"padding":"28px","borderRadius":"22px","background":"rgba(255,255,255,.06)","border":"1px solid rgba(255,255,255,.1)"})}>
            <span style={css({"color":"#f6a27e"})}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l9 16H3z" />
                <path d="M12 10v4M12 17v.5" />
              </svg>
            </span>
            <div style={css({"marginTop":"20px","fontSize":"22px","fontWeight":"500","letterSpacing":"-.025em"})}>Lo ambiguo no se aprueba</div>
            <div style={css({"marginTop":"8px","fontSize":"16px","lineHeight":"1.5","color":"rgba(255,255,255,.7)"})}>
              Proveedor no reconocido, contrato ambiguo, moneda no comparable o falta de evidencia: nunca se aprueba.
            </div>
          </div>
          <div style={css({"padding":"28px","borderRadius":"22px","background":"rgba(255,255,255,.06)","border":"1px solid rgba(255,255,255,.1)"})}>
            <span style={css({"color":"#f6a27e"})}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </span>
            <div style={css({"marginTop":"20px","fontSize":"22px","fontWeight":"500","letterSpacing":"-.025em"})}>El historial no autoriza</div>
            <div style={css({"marginTop":"8px","fontSize":"16px","lineHeight":"1.5","color":"rgba(255,255,255,.7)"})}>Solo una acción humana explícita crea una autorización.</div>
          </div>
          <div style={css({"padding":"28px","borderRadius":"22px","background":"rgba(255,255,255,.06)","border":"1px solid rgba(255,255,255,.1)"})}>
            <span style={css({"color":"#f6a27e"})}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16v12H4z" />
                <path d="M4 7l8 6 8-6" />
              </svg>
            </span>
            <div style={css({"marginTop":"20px","fontSize":"22px","fontWeight":"500","letterSpacing":"-.025em"})}>Señal sin verificar</div>
            <div style={css({"marginTop":"8px","fontSize":"16px","lineHeight":"1.5","color":"rgba(255,255,255,.7)"})}>
              Solo sube la cautela. Un correo puede hacer que un pago se escale o se retenga; nunca lo habilita.
            </div>
          </div>
          <div style={css({"padding":"28px","borderRadius":"22px","background":"rgba(255,255,255,.06)","border":"1px solid rgba(255,255,255,.1)"})}>
            <span style={css({"color":"#f6a27e"})}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v18M16 7.5C16 6 14 5 12 5s-4 1-4 2.8c0 4 8 2 8 6.2 0 1.700-2 2.800-4 2.800s-4-1-4-2.500" />
              </svg>
            </span>
            <div style={css({"marginTop":"20px","fontSize":"22px","fontWeight":"500","letterSpacing":"-.025em"})}>Dinero exacto</div>
            <div style={css({"marginTop":"8px","fontSize":"16px","lineHeight":"1.5","color":"rgba(255,255,255,.7)"})}>Importes en enteros, con la moneda siempre explícita.</div>
          </div>
          <div style={css({"padding":"28px","borderRadius":"22px","background":"rgba(255,255,255,.06)","border":"1px solid rgba(255,255,255,.1)"})}>
            <span style={css({"color":"#f6a27e"})}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z" />
              </svg>
            </span>
            <div style={css({"marginTop":"20px","fontSize":"22px","fontWeight":"500","letterSpacing":"-.025em"})}>Todo por organización</div>
            <div style={css({"marginTop":"8px","fontSize":"16px","lineHeight":"1.5","color":"rgba(255,255,255,.7)"})}>
              Cada consulta y acción está acotada a la organización y al rol de la persona, no solo en la pantalla.
            </div>
          </div>
        </div>
      </div>
    </section>

    <section style={css({"position":"relative","padding":"clamp(72px,10vw,130px) 24px","background":"#f7f6f4","color":"#111"})}>
      <div style={css({"maxWidth":"1180px","margin":"0 auto"})}>
        <div style={css({"textAlign":"center","display":"flex","flexDirection":"column","alignItems":"center"})}>
          <div style={css({"display":"flex","gap":"10px","alignItems":"center","fontSize":"15px","fontWeight":"500","color":"#444"})}>
            <span style={css({"width":"28px","height":"28px","borderRadius":"50%","background":"#111","color":"#fff","display":"grid","placeItems":"center","fontSize":"13px"})}>10</span>
            Todo en un solo panel
          </div>
          <h2 style={css({"margin":"22px 0 0","maxWidth":"880px","fontSize":"clamp(34px,4.8vw,64px)","lineHeight":"1.02","letterSpacing":"-.05em","fontWeight":"500","textWrap":"balance"})}>Un panel para ver qué entró, qué se decidió y por qué.</h2>
          <div style={css({"marginTop":"28px","display":"flex","flexWrap":"wrap","gap":"10px","justifyContent":"center","maxWidth":"820px"})}>
            <span style={css({"padding":"10px 18px","borderRadius":"99px","background":"#fff","boxShadow":"0 1px 2px rgba(0,0,0,.06)","fontSize":"16px"})}>Bandeja de facturas</span>
            <span style={css({"padding":"10px 18px","borderRadius":"99px","background":"#fff","boxShadow":"0 1px 2px rgba(0,0,0,.06)","fontSize":"16px"})}>Detalle con evidencia y explicación</span>
            <span style={css({"padding":"10px 18px","borderRadius":"99px","background":"#fff","boxShadow":"0 1px 2px rgba(0,0,0,.06)","fontSize":"16px"})}>Historial de pagos (CSV)</span>
            <span style={css({"padding":"10px 18px","borderRadius":"99px","background":"#fff","boxShadow":"0 1px 2px rgba(0,0,0,.06)","fontSize":"16px"})}>Aprobaciones pendientes</span>
            <span style={css({"padding":"10px 18px","borderRadius":"99px","background":"#fff","boxShadow":"0 1px 2px rgba(0,0,0,.06)","fontSize":"16px"})}>Contratos</span>
            <span style={css({"padding":"10px 18px","borderRadius":"99px","background":"#fff","boxShadow":"0 1px 2px rgba(0,0,0,.06)","fontSize":"16px"})}>Auditoría</span>
          </div>
        </div>
        <div style={css({"marginTop":"56px","borderRadius":"26px","padding":"12px","background":"rgba(255,255,255,.6)","boxShadow":"0 20px 70px rgba(120,80,200,.15)"})}>
          <img src="/landing/panel.png" alt="Panel de Pacta" style={css({"display":"block","width":"100%","height":"auto","borderRadius":"16px","background":"#fff"})} />
        </div>
        <div style={css({"marginTop":"48px","display":"flex","justifyContent":"center"})}>
          <Link className="lift-white" href={enterHref} style={css({"padding":"18px 34px","borderRadius":"99px","background":"#111","color":"#fff","fontSize":"19px","fontWeight":"500","transition":"transform .25s"})}>Entrar a Pacta →</Link>
        </div>
      </div>
    </section>
    </div>
  );
}
