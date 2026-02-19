export interface IPromptExample {
    prompt: string;
    code: string;
}

export const OpenScadExamples: IPromptExample[] = [
    {
        prompt: "Create a cute bear",
        code: `
$fn = 100;

// Parameters for customization
bear_size = 100;
body_color = [0.6, 0.4, 0.2];
belly_color = [0.8, 0.6, 0.4];
nose_color = [0.2, 0.2, 0.2];

// Main body module
module bear_body() {
    color(body_color) {
        // Main body
        scale([1, 0.8, 1])
        sphere(d=bear_size);
        
        // Head
        translate([0, 0, bear_size * 0.7])
        sphere(d=bear_size * 0.8);
        
        // Ears
        translate([bear_size * 0.3, 0, bear_size * 1.1])
        sphere(d=bear_size * 0.25);
        translate([-bear_size * 0.3, 0, bear_size * 1.1])
        sphere(d=bear_size * 0.25);
        
        // Arms
        translate([bear_size * 0.4, 0, bear_size * 0.1])
        rotate([0, -30, 20])
        scale([0.3, 0.3, 0.6])
        sphere(d=bear_size);
        
        translate([-bear_size * 0.4, 0, bear_size * 0.1])
        rotate([0, -30, -20])
        scale([0.3, 0.3, 0.6])
        sphere(d=bear_size);
        
        // Legs
        translate([bear_size * 0.25, 0, -bear_size * 0.4])
        scale([0.25, 0.25, 0.4])
        sphere(d=bear_size);
        
        translate([-bear_size * 0.25, 0, -bear_size * 0.4])
        scale([0.25, 0.25, 0.4])
        sphere(d=bear_size);
    }
}

// Belly and face details
module bear_belly() {
    color(belly_color) {
        // Belly
        translate([0, bear_size * 0.3, 0])
        scale([0.7, 0.4, 0.7])
        sphere(d=bear_size);
        
        // Snout
        translate([0, bear_size * 0.4, bear_size * 0.6])
        scale([0.4, 0.3, 0.3])
        sphere(d=bear_size);
        
        // Inner ears
        translate([bear_size * 0.3, 0.1, bear_size * 1.1])
        scale([0.6, 0.6, 0.6])
        sphere(d=bear_size * 0.15);
        
        translate([-bear_size * 0.3, 0.1, bear_size * 1.1])
        scale([0.6, 0.6, 0.6])
        sphere(d=bear_size * 0.15);
    }
}

// Nose and eyes
module bear_face() {
    color(nose_color) {
        // Nose
        translate([0, bear_size * 0.55, bear_size * 0.65])
        sphere(d=bear_size * 0.12);
        
        // Eyes
        translate([bear_size * 0.15, bear_size * 0.35, bear_size * 0.8])
        sphere(d=bear_size * 0.08);
        
        translate([-bear_size * 0.15, bear_size * 0.35, bear_size * 0.8])
        sphere(d=bear_size * 0.08);
    }
}

// Assembly
module cute_bear() {
    bear_body();
    bear_belly();
    bear_face();
}

// Create the bear
cute_bear();
`
},
{
    prompt: "Create a cute mouse",
    code: `
$fn = 100;

// Parameters for customization
mouse_size = 40;
body_color = [0.8, 0.8, 0.8];  // Grey
inner_color = [1, 0.8, 0.8];   // Pink
detail_color = [0.1, 0.1, 0.1]; // Black

// Main body and outer features
module mouse_body() {
    color(body_color) {
        // Main body
        scale([1, 1.2, 0.8])
        sphere(d=mouse_size);
        
        // Head
        translate([mouse_size * 0.3, 0, mouse_size * 0.2])
        scale([0.8, 0.7, 0.7])
        sphere(d=mouse_size);
        
        // Snout
        translate([mouse_size * 0.7, 0, mouse_size * 0.1])
        scale([0.4, 0.3, 0.25])
        sphere(d=mouse_size);
        
        // Ears
        translate([mouse_size * 0.3, mouse_size * 0.25, mouse_size * 0.5])
        scale([0.3, 0.3, 0.4])
        sphere(d=mouse_size);
        
        translate([mouse_size * 0.3, -mouse_size * 0.25, mouse_size * 0.5])
        scale([0.3, 0.3, 0.4])
        sphere(d=mouse_size);
        
        // Tail
        translate([-mouse_size * 0.3, 0, 0])
        rotate([0, -10, 0])
        scale([1, 0.15, 0.15])
        sphere(d=mouse_size * 1.5);
        
        // Front paws
        translate([mouse_size * 0.4, mouse_size * 0.2, -mouse_size * 0.2])
        scale([0.2, 0.15, 0.1])
        sphere(d=mouse_size);
        
        translate([mouse_size * 0.4, -mouse_size * 0.2, -mouse_size * 0.2])
        scale([0.2, 0.15, 0.1])
        sphere(d=mouse_size);
        
        // Back paws
        translate([-mouse_size * 0.2, mouse_size * 0.25, -mouse_size * 0.2])
        scale([0.25, 0.2, 0.15])
        sphere(d=mouse_size);
        
        translate([-mouse_size * 0.2, -mouse_size * 0.25, -mouse_size * 0.2])
        scale([0.25, 0.2, 0.15])
        sphere(d=mouse_size);
    }
}

// Inner ears and belly
module mouse_inner() {
    color(inner_color) {
        // Inner ears
        translate([mouse_size * 0.3, mouse_size * 0.25, mouse_size * 0.5])
        scale([0.2, 0.2, 0.3])
        sphere(d=mouse_size);
        
        translate([mouse_size * 0.3, -mouse_size * 0.25, mouse_size * 0.5])
        scale([0.2, 0.2, 0.3])
        sphere(d=mouse_size);
        
        // Belly
        translate([mouse_size * 0.1, 0, 0])
        scale([0.8, 0.6, 0.6])
        sphere(d=mouse_size * 0.8);
    }
}

// Face details
module mouse_details() {
    color(detail_color) {
        // Eyes
        translate([mouse_size * 0.5, mouse_size * 0.15, mouse_size * 0.25])
        sphere(d=mouse_size * 0.12);
        
        translate([mouse_size * 0.5, -mouse_size * 0.15, mouse_size * 0.25])
        sphere(d=mouse_size * 0.12);
        
        // Nose
        translate([mouse_size * 0.8, 0, mouse_size * 0.1])
        sphere(d=mouse_size * 0.1);
        
        // Whiskers
        for(i = [-1, 0, 1]) {
            translate([mouse_size * 0.7, 0, mouse_size * 0.1])
            rotate([0, i * 15, 45])
            cylinder(h=mouse_size * 0.4, d=mouse_size * 0.02);
            
            translate([mouse_size * 0.7, 0, mouse_size * 0.1])
            rotate([0, i * 15, -45])
            cylinder(h=mouse_size * 0.4, d=mouse_size * 0.02);
        }
    }
}

// Assembly
module cute_mouse() {
    mouse_body();
    mouse_inner();
    mouse_details();
}

// Create the mouse
cute_mouse();
`
},
{
    prompt: "create a hollowed out storage box with 30x30x30 cm size, which is open at the top. the wall thickness is 2mm. add two rounded handling slots, each about 10cm long and 1.5cm high on opposite sides for easy transportation. the slots are 5 cm from the top of the box.",
    code: `
// Set minimum facet angle and size
$fn = 100;

// Main box module
module storage_box(width, depth, height, wall_thickness, slot_length, slot_height, slot_distance_from_top) {
    difference() {
        // Outer shell
        cube([width, depth, height]);
        
        // Inner shell
        translate([wall_thickness, wall_thickness, wall_thickness])
        cube([
            width - 2*wall_thickness, 
            depth - 2*wall_thickness, 
            height - wall_thickness
        ]);
        
        // Left handling slot
        translate([0, depth/2 - slot_length/2, height - slot_distance_from_top - slot_height/2])
        rotate([0, 90, 0])
        hull() {
            cylinder(h = wall_thickness, d = slot_height);
            translate([0, slot_length, 0])
            cylinder(h = wall_thickness, d = slot_height);
        }
        
        // Right handling slot
        translate([width - wall_thickness, depth/2 - slot_length/2, height - slot_distance_from_top - slot_height/2])
        rotate([0, 90, 0])
        hull() {
            cylinder(h = wall_thickness, d = slot_height);
            translate([0, slot_length, 0])
            cylinder(h = wall_thickness, d = slot_height);
        }
    }
}

// Create box with specified dimensions
storage_box(
    width = 300,          // 30cm
    depth = 300,          // 30cm
    height = 300,         // 30cm
    wall_thickness = 2,   // 2mm
    slot_length = 100,    // 10cm
    slot_height = 15,     // 1.5cm
    slot_distance_from_top = 50  // 5cm
);
`},
{
    prompt: "Create a dodecahedron",
    code: `    
//create a dodecahedron by intersecting 6 boxes
module dodecahedron(height) 
{
	scale([height,height,height]) //scale by height parameter
	{
		intersection(){
			//make a cube
			cube([2,2,1], center = true); 
			intersection_for(i=[0:4]) //loop i from 0 to 4, and intersect results
			{ 
				//make a cube, rotate it 116.565 degrees around the X axis,
				//then 72*i around the Z axis
				rotate([0,0,72*i])
					rotate([116.565,0,0])
					cube([2,2,1], center = true); 
			}
		}
	}
}
//create 3 stacked dodecahedra 
//call the module with a height of 1 and move up 2
translate([0,0,2])dodecahedron(1); 
//call the module with a height of 2
dodecahedron(2); 
//call the module with a height of 4 and move down 4
translate([0,0,-4])dodecahedron(4);
`},
{
    prompt: "Create an icosahedron",
    code: `
phi=0.5*(sqrt(5)+1); // golden ratio

// create an icosahedron by intersecting 3 orthogonal golden-ratio rectangles
module icosahedron(edge_length) {
   st=0.0001;  // microscopic sheet thickness
   hull() {
       cube([edge_length*phi, edge_length, st], true);
       rotate([90,90,0]) cube([edge_length*phi, edge_length, st], true);
       rotate([90,0,90]) cube([edge_length*phi, edge_length, st], true);
   }
}

edge=10;

icosahedron(edge);
`},
{
    prompt: "Create an icosphere",
    code: `
// Code via reddit with triangle winding fixes, cannot add link due to
// wikibooks considering it spam.

// 4 is the realistic max.
// Don't do 5 or more, takes forever.
// set recursion to the desired level. 0=20 tris, 1=80 tris, 2=320 tris
module icosphere(radius=10, recursion=2, icoPnts, icoTris) {
  //t = (1 + sqrt(5))/2;
  //comment from monfera to get verts to unit sphere
  t = sqrt((5+sqrt(5))/10);
  s = sqrt((5-sqrt(5))/10);
  
  init = (icoPnts||icoTris) ? false : true; //initial call if icoPnts is empty
  
  // 1 --> draw icosphere from base mesh
  // 2 --> loop through base mesh and subdivide by 4 --> 20 steps
  // 3 --> loop through subdivided mesh and subdivide again (or subdivide by 16) --> 80 steps
  // 4 ...
  
  verts = [
    [-s, t, 0],  //0
    [ s, t, 0],
    [-s,-t, 0],
    [ s,-t, 0],
    [ 0,-s, t],
    [ 0, s, t],
    [ 0,-s,-t],
    [ 0, s,-t],
    [ t, 0,-s],
    [ t, 0, s],
    [-t, 0,-s],
    [-t, 0, s]]; //11
  
  //base mesh with 20 faces
  tris = [
    //5 faces around point 0
    [ 0, 5, 11], //0
    [ 0, 1, 5],
    [ 0, 7, 1],
    [ 0, 10, 7],
    [ 0, 11, 10], 
    // 5 adjacent faces
    [ 1, 9, 5], //5
    [ 5, 4, 11],
    [11, 2, 10],
    [10, 6, 7],
    [ 7, 8, 1], 
    //5 faces around point 3
    [ 3, 4, 9], //10
    [ 3, 2, 4],
    [ 3, 6, 2],
    [ 3, 8, 6],
    [ 3, 9, 8], 
    //5 adjacent faces 
    [ 4, 5, 9], //15
    [ 2, 11, 4],
    [ 6, 10, 2],
    [ 8, 7, 6],
    [ 9, 1, 8]];  //19
    
  if (recursion) {
    verts = (init) ? verts : icoPnts;
    tris = (init) ? tris : icoTris;
    newSegments = recurseTris(verts,tris);
    newVerts = newSegments[0];
    newTris = newSegments[1];
    icosphere(radius,recursion-1,newVerts,newTris);
  } else if (init) { //draw the base icosphere if no recursion and initial call
    scale(radius) polyhedron(verts, tris); 
  } else { // if not initial call some recursion has to be happened
    scale(radius) polyhedron(icoPnts, icoTris);
  } 
}

// Adds verts if not already there, 
// takes array of vertices and indices of a tri to expand
// returns expanded array of verts and indices of new polygon with 4 faces
// [[verts],[0,(a),(c)],[1,(b),(a)],[2,(c),(b)],[(a),(b),(c)]]
function addTris(verts, tri) = let(
    a= getMiddlePoint(verts[tri[0]], verts[tri[1]]), //will produce doubles
    b= getMiddlePoint(verts[tri[1]], verts[tri[2]]), //these are unique
    c= getMiddlePoint(verts[tri[2]], verts[tri[0]]), //these are unique
    
    aIdx = search(verts, a), //point a already exists
    l=len(verts)                       
  ) len(aIdx) ? [concat(verts,[a,b,c]),[[tri[0],l,l+2],   //1
                                        [tri[1],l+1,l],   //2
                                        [tri[2],l+2,l+1], //3
                                        [l,l+1,l+2]] ] :  //4

                [concat(verts,[b,c]), [[tri[0],aIdx,l+1], //1
                                      [tri[1],l,aIdx],    //2
                                      [tri[2],l+1,l],     //3
                                      [aIdx,l,l+1]] ];    //4

// Recursive function that does one recursion on the whole icosphere (auto recursion steps derived from len(tris)).
function recurseTris(verts, tris, newTris=[], steps=0, step=0) = let(
    stepsCnt = steps ? steps : len(tris)-1, //if initial call initialize steps
    newSegment=addTris(verts=verts,tri=tris[step]),
    newVerts=newSegment[0], //all old and new Vertices
    newerTris=concat(newTris,newSegment[1]) //only new Tris
  ) (stepsCnt==(step)) ? [newVerts,newerTris] :
                           recurseTris(newVerts,tris,newerTris,stepsCnt,step+1);
                
// Get point between two verts on unit sphere.
function getMiddlePoint(p1, p2) = fixPosition((p1+p2)/2);

// Fix position to be on unit sphere
function fixPosition(p) = let(l=norm(p)) [p.x/l,p.y/l,p.z/l];

icosphere();
`},
{
    prompt: "Create a half-pyramid",
    code: `
// Create a half-pyramid from a single linear extrusion
module halfpyramid(base, height) {
   linear_extrude(height, scale=0.01)
      translate([-base/2, 0, 0]) square([base, base/2]);
}

halfpyramid(20, 10);
`},
{
    prompt: "Create a bounding box for an object",
    code: `
// Rather kludgy module for determining bounding box from intersecting projections
module BoundingBox()
{
	intersection()
	{
		translate([0,0,0])
		linear_extrude(height = 1000, center = true, convexity = 10, twist = 0) 
		projection(cut=false) intersection()
		{
			rotate([0,90,0]) 
			linear_extrude(height = 1000, center = true, convexity = 10, twist = 0) 
			projection(cut=false) 
			rotate([0,-90,0]) 
			children(0);

			rotate([90,0,0]) 
			linear_extrude(height = 1000, center = true, convexity = 10, twist = 0) 
			projection(cut=false) 
			rotate([-90,0,0]) 
			children(0);
		}
		rotate([90,0,0]) 
		linear_extrude(height = 1000, center = true, convexity = 10, twist = 0) 
		projection(cut=false) 
		rotate([-90,0,0])
		intersection()
		{
			rotate([0,90,0]) 
			linear_extrude(height = 1000, center = true, convexity = 10, twist = 0) 
			projection(cut=false) 
			rotate([0,-90,0]) 
			children(0);

			rotate([0,0,0]) 
			linear_extrude(height = 1000, center = true, convexity = 10, twist = 0) 
			projection(cut=false) 
			rotate([0,0,0]) 
			children(0);
		}
	}
}

// Test module on ellipsoid
translate([0,0,40]) scale([1,2,3]) sphere(r=5);
BoundingBox() scale([1,2,3]) sphere(r=5);
`},
{
    prompt: "Create an example of a linear extrusion as an interpolated function",
    code: `
//Linear Extrude with Scale as an interpolated function
// This module does not need to be modified, 
// - unless default parameters want to be changed 
// - or additional parameters want to be forwarded (e.g. slices,...)
module linear_extrude_fs(height=1,isteps=20,twist=0){
 //union of piecewise generated extrudes
 union(){ 
   for(i = [ 0: 1: isteps-1]){
     //each new piece needs to be adjusted for height
     translate([0,0,i*height/isteps])
      linear_extrude(
       height=height/isteps,
       twist=twist/isteps,
       scale=f_lefs((i+1)/isteps)/f_lefs(i/isteps)
      )
       // if a twist constant is defined it is split into pieces
       rotate([0,0,-(i/isteps)*twist])
        // each new piece starts where the last ended
        scale(f_lefs(i/isteps))
         obj2D_lefs();
   }
 }
}
// This function defines the scale function
// - Function name must not be modified
// - Modify the contents/return value to define the function
function f_lefs(x) = 
 let(span=150,start=20,normpos=45)
 sin(x*span+start)/sin(normpos);
// This module defines the base 2D object to be extruded
// - Function name must not be modified
// - Modify the contents to define the base 2D object
module obj2D_lefs(){ 
 translate([-4,-3])
  square([9,12]);
}

//Top rendered object demonstrating the interpolation steps
translate([0,0,25])
linear_extrude_fs(height=20,isteps=4);

linear_extrude_fs(height=20);

//Bottom rendered object demonstrating the inclusion of a twist
translate([0,0,-25])
linear_extrude_fs(height=20,twist=90,isteps=30);
`},
{
    prompt: "Create a linear Extrude with Twist as an interpolated function",
    code: `
//Linear Extrude with Twist as an interpolated function
// This module does not need to be modified, 
// - unless default parameters want to be changed 
// - or additional parameters want to be forwarded (e.g. slices,...)
module linear_extrude_ft(height=1,isteps=20,scale=1){
  //union of piecewise generated extrudes
  union(){
    for(i = [ 0: 1: isteps-1]){
      //each new piece needs to be adjusted for height
      translate([0,0,i*height/isteps])
       linear_extrude(
        height=height/isteps,
        twist=f_left((i+1)/isteps)-f_left((i)/isteps),
        scale=(1-(1-scale)*(i+1)/isteps)/(1-(1-scale)*i/isteps)
       )
        //Rotate to next start point
        rotate([0,0,-f_left(i/isteps)])
         //Scale to end of last piece size  
         scale(1-(1-scale)*(i/isteps))
          obj2D_left();
    }
  }
}
// This function defines the twist function
// - Function name must not be modified
// - Modify the contents/return value to define the function
function f_left(x) = 
  let(twist=90,span=180,start=0)
  twist*sin(x*span+start);
// This module defines the base 2D object to be extruded
// - Function name must not be modified
// - Modify the contents to define the base 2D object
module obj2D_left(){
  translate([-4,-3]) 
   square([12,9]);
}
//Left rendered object demonstrating the interpolation steps
translate([-20,0])
linear_extrude_ft(height=30,isteps=5);
linear_extrude_ft(height=30);
//Right rendered object demonstrating the scale inclusion
translate([25,0])
linear_extrude_ft(height=30,scale=3);
`},
{
    prompt: "Create a Linear Extrude with Twist and Scale as interpolated functions",
    code: `
//Linear Extrude with Twist and Scale as interpolated functions
// This module does not need to be modified, 
// - unless default parameters want to be changed 
// - or additional parameters want to be forwarded
module linear_extrude_ftfs(height=1,isteps=20,slices=0){
  //union of piecewise generated extrudes
  union(){ 
   for(i=[0:1:isteps-1]){
    translate([0,0,i*height/isteps])
     linear_extrude(
      height=height/isteps,
      twist=leftfs_ftw((i+1)/isteps)-leftfs_ftw(i/isteps), 
      scale=leftfs_fsc((i+1)/isteps)/leftfs_fsc(i/isteps),
      slices=slices
     )
      rotate([0,0,-leftfs_ftw(i/isteps)])
       scale(leftfs_fsc(i/isteps))
        obj2D_leftfs();
   }
  }
}
// This function defines the scale function
// - Function name must not be modified
// - Modify the contents/return value to define the function
function leftfs_fsc(x)=
  let(scale=3,span=140,start=20)
  scale*sin(x*span+start);
// This function defines the twist function
// - Function name must not be modified
// - Modify the contents/return value to define the function
function leftfs_ftw(x)=
  let(twist=30,span=360,start=0)
  twist*sin(x*span+start);
// This module defines the base 2D object to be extruded
// - Function name must not be modified
// - Modify the contents to define the base 2D object
module obj2D_leftfs(){
   square([12,9]);
}
//Left rendered objects demonstrating the steps effect
translate([0,-50,-60])
rotate([0,0,90])
linear_extrude_ftfs(height=50,isteps=3);

translate([0,-50,0])
linear_extrude_ftfs(height=50,isteps=3);
//Center rendered objects demonstrating the slices effect
translate([0,0,-60])
rotate([0,0,90])
linear_extrude_ftfs(height=50,isteps=3,slices=20);

linear_extrude_ftfs(height=50,isteps=3,slices=20);
//Right rendered objects with default parameters
translate([0,50,-60])
rotate([0,0,90])
linear_extrude_ftfs(height=50);

translate([0,50,0])
linear_extrude_ftfs(height=50);
`},
{
    prompt: "Create a rocket",
    code: `
// increase the visual detail
$fn = 100;

// the main body :
// a cylinder
rocket_d = 30; 				// 3 cm wide
rocket_r = rocket_d / 2;
rocket_h = 100; 			// 10 cm tall
cylinder(d = rocket_d, h = rocket_h);

// the head :
// a cone
head_d = 40;  				// 4 cm wide
head_r = head_d / 2;
head_h = 40;  				// 4 cm tall
// prepare a triangle
tri_base = head_r;
tri_height = head_h;
tri_points = [[0,			 0],
			  [tri_base,	 0],
			  [0,	tri_height]];
// rotation around X-axis and then 360° around Z-axis
// put it on top of the rocket's body
translate([0,0,rocket_h])
rotate_extrude(angle = 360)
	polygon(tri_points);

// the wings :
// 3x triangles
wing_w = 2;					// 2 mm thick
many = 3;					// 3x wings
wing_l = 40;				// length
wing_h = 40;				// height
wing_points = [[0,0],[wing_l,0],[0,wing_h]];

module wing() {
	// let it a bit inside the main body
	in_by = 1;				// 1 mm
	// set it up on the rocket's perimeter
	translate([rocket_r - in_by,0,0])
	// set it upright by rotating around X-axis
	rotate([90,0,0])
	// set some width and center it
	linear_extrude(height = wing_w,center = true)
	// make a triangle
		polygon(wing_points);
}

for (i = [0: many - 1])
	rotate([0, 0, 370 / many * i])
	wing();
`},
{
    prompt: "Create a twisted horn",
    code: `
// The idea is to twist a translated circle:
// -
/*
	linear_extrude(height = 10, twist = 360, scale = 0)
	translate([1,0])
	circle(r = 1);
*/

module horn(height = 10, radius = 6, 
			twist = 720, $fn = 50) 
{
	// A centered circle translated by 1xR and 
	// twisted by 360° degrees, covers a 2x(2xR) space.
	// -
	radius = radius/4;
	// De-translate.
	// -
	translate([-radius,0])
	// The actual code.
	// -
	linear_extrude(height = height, twist = twist, 
				   scale=0, $fn = $fn)
	translate([radius,0])
	circle(r=radius);
}

translate([3,0])
mirror()
horn();

translate([-3,0])
horn();
`},
{
    prompt: "Create a Jansen mechanism",
    code: `
//------------------------
// Trigonometry Functions
//------------------------
function add2D(v1=[0,0],v2=[0,0]) =
    [
        v1[0]+v2[0],
        v1[1]+v2[1]
    ];
  
function sub2D(v1=[0,0],v2=[0,0]) = 
    [
        v1[0]-v2[0], 
        v1[1]-v2[1]
    ];

function addAngle2D(v1=[0,0],ang=0,l=0) = 
    [
        v1[0]+cos(ang)*l,
        v1[1]-sin(ang)*l
    ];

function getAngle2D(v1,v2=[0,0]) =
  atan2(
    (v2[0]-v1[0]), //dx
    (v2[1]-v1[1])  //dy
  );

function scale2D(v1=[0,0],c=1)= 
  [
    v1[0]*c,
    v1[1]*c,
  ];

function length2D(v1,v2=[0,0])=
  sqrt(
      (v1[0]-v2[0])*(v1[0]-v2[0])
      +
      (v1[1]-v2[1])*(v1[1]-v2[1])
    );

//Law of cosines
function VVLL2D(v1,v2,l1,l2) =
  let(sAB = length2D(v1,v2))
  let(ang12=getAngle2D(v2,v1))
  let(ang0=
        acos(
          (l2*l2-l1*l1-sAB*sAB)/
          (-abs(2*sAB*l1))
        ))
        
  addAngle2D(
    v1=v1,
    ang=ang0+ang12-90,
    l=-l1
  );

//----------------------
// modules (Graphic Functions)
//----------------------
// draw "rod" from v1 to v2 with thickness t
module rod(v1=[0,0],v2=[0,0],t=6){
		ang1=getAngle2D(v1,v2);
    len1=length2D(v1,v2);
		translate([v1[0],v1[1]])
		rotate([0,0,-ang1]){
			translate([0,0,0]){
					cylinder(r=t,h=t+2,center = true);
			}
			translate([-t/2,0,-t/2]){
				cube([t,len1,t]);
			}
		}
}

//----------------------
// Leg Module // Jansen mechanism
//----------------------
module leg (
    ang=0,
    a=38.0, //a..m Theo Jansens Constants
    b=41.5,
    c=39.3,
    d=40.1,
    e=55.8,
    f=39.4,
    g=36.7,
    h=65.7,
    i=49.0,
    j=50.0,
    k=61.9,
    l= 7.8,
    m=15.0
    )
{
  Z = [0,0]; //Origin
  X = addAngle2D(Z,ang,m); //Crank / "backbone"
  Y = add2D(Z,[a,l]);
  W = VVLL2D(X,Y,j,b);
  V = VVLL2D(W,Y,e,d);
  U = VVLL2D(Y,X,c,k);
  T = VVLL2D(V,U,f,g);
  S = VVLL2D(T,U,h,i); //Foot
   
  rod(Z, X);
  rod(X, W);

  rod(W, Y);
  rod(W, V);
  rod(Y, V);
  rod(X, U);
  rod(Y, U);
  rod(U, T);
  rod(V, T);
  rod(U, S);
  rod(T, S);
  rod(Z, Y);

  //draw the foot point
  translate(S){
    cylinder(r=8,h=8,center = true); 
  }
}

//----------------------
// Strandbeest
//----------------------
module Strandbeest(ang=$t*360,o=360/3,sgap=20,mgap=50)
{
    {
        color([1, 0, 0]) translate([0,0,sgap*0]) leg(ang+o*0);
        color([0, 1, 0]) translate([0,0,sgap*1]) leg(ang+o*1);
        color([0, 0, 1]) translate([0,0,sgap*2]) leg(ang+o*2);
    }
    mirror(v= [1, 0, 0] ){
        color([1, 0, 0]) translate([0,0,sgap*0]) leg(180-ang-o*0);
        color([0, 1, 0]) translate([0,0,sgap*1]) leg(180-ang-o*1);
        color([0, 0, 1]) translate([0,0,sgap*2]) leg(180-ang-o*2);
    }
    translate([0,0,sgap*2 + mgap])
    {
        color([1, 0, 0]) translate([0,0,sgap*0]) leg(180+ang+o*0);
        color([0, 1, 0]) translate([0,0,sgap*1]) leg(180+ang+o*1);
        color([0, 0, 1]) translate([0,0,sgap*2]) leg(180+ang+o*2);
    }
    translate([0,0,sgap*2 + mgap])   
    mirror(v= [1, 0, 0] ){
        color([1, 0, 0]) translate([0,0,sgap*0]) leg(0-ang-o*0);
        color([0, 1, 0]) translate([0,0,sgap*1]) leg(0-ang-o*1);
        color([0, 0, 1]) translate([0,0,sgap*2]) leg(0-ang-o*2);
    }
}

//leg(ang=$t*360);

rotate([90,180,0]) Strandbeest();
`},
{
    prompt: "Create a shorkie dog",
    code: `
// prompt: create a shorkie dog

$fn = 100;

// Parameters for customization
dog_size = 40;
body_color = [0.6, 0.4, 0.2];    // Brown/tan
dark_color = [0.2, 0.2, 0.2];    // Black
light_color = [0.8, 0.6, 0.4];   // Light tan
detail_color = [0.1, 0.1, 0.1];  // Black for eyes and nose

// Main body structure
module dog_body() {
    color(body_color) {
        // Main body
        translate([0, 0, dog_size * 0.3])
        scale([1.2, 0.8, 0.6])
        sphere(d=dog_size);
        
        // Neck
        translate([dog_size * 0.3, 0, dog_size * 0.4])
        scale([0.4, 0.4, 0.4])
        sphere(d=dog_size);
        
        // Head
        translate([dog_size * 0.6, 0, dog_size * 0.5])
        scale([0.5, 0.45, 0.45])
        sphere(d=dog_size);
        
        // Snout
        translate([dog_size * 0.85, 0, dog_size * 0.45])
        scale([0.25, 0.2, 0.2])
        sphere(d=dog_size);
        
        // Legs
        for (x = [-0.2, 0.2]) {
            for (y = [-0.2, 0.2]) {
                translate([dog_size * x, dog_size * y, dog_size * 0.1])
                scale([0.15, 0.15, 0.4])
                sphere(d=dog_size);
            }
        }
        
        // Tail
        translate([-dog_size * 0.5, 0, dog_size * 0.3])
        union() {
            // Base of tail
            rotate([0, -30, 0])
            scale([0.15, 0.15, 0.2])
            sphere(d=dog_size);
            
            // Middle section curving up
            translate([0, 0, dog_size * 0.1])
            rotate([0, 60, 0])
            scale([0.12, 0.12, 0.2])
            sphere(d=dog_size);
            
            // Tip section curling over
            translate([dog_size * 0.1, 0, dog_size * 0.25])
            rotate([0, 120, 0])
            scale([0.1, 0.1, 0.15])
            sphere(d=dog_size);
        }
    }
}

// Dark fur patches
module dark_fur() {
    color(dark_color) {
        // Back patch - adjusted to follow body contour
        translate([0, 0, dog_size * 0.48])  // Lowered position
        scale([1.1, 0.7, 0.2])            // Increased thickness, adjusted width
        sphere(d=dog_size);
        
        // Additional back patch for smooth transition
        translate([0, 0, dog_size * 0.45])
        scale([0.9, 0.6, 0.15])
        sphere(d=dog_size);
        
        // Head patch
        translate([dog_size * 0.6, 0, dog_size * 0.7])
        scale([0.3, 0.25, 0.15])
        sphere(d=dog_size);
        
        // Ear patches
        translate([dog_size * 0.7, dog_size * 0.25, dog_size * 0.6])
        scale([0.2, 0.1, 0.25])
        sphere(d=dog_size);
        
        translate([dog_size * 0.7, -dog_size * 0.25, dog_size * 0.6])
        scale([0.2, 0.1, 0.25])
        sphere(d=dog_size);
        
        // Tail patch
        translate([-dog_size * 0.5, 0, dog_size * 0.4])
        rotate([0, 60, 0])
        scale([0.15, 0.15, 0.25])
        sphere(d=dog_size);
    }
}

// Light fur accents
module light_fur() {
    color(light_color) {
        // Chest
        translate([dog_size * 0.3, 0, dog_size * 0.3])
        scale([0.3, 0.4, 0.4])
        sphere(d=dog_size);
        
        // Face
        translate([dog_size * 0.75, 0, dog_size * 0.45])
        scale([0.2, 0.3, 0.3])
        sphere(d=dog_size);
        
        // Inner ears
        translate([dog_size * 0.7, dog_size * 0.25, dog_size * 0.6])
        scale([0.15, 0.05, 0.2])
        sphere(d=dog_size);
        
        translate([dog_size * 0.7, -dog_size * 0.25, dog_size * 0.6])
        scale([0.15, 0.05, 0.2])
        sphere(d=dog_size);
    }
}

// Face details
module face_details() {
    color(detail_color) {
        // Eyes
        translate([dog_size * 0.75, dog_size * 0.15, dog_size * 0.55])
        sphere(d=dog_size * 0.08);
        
        translate([dog_size * 0.75, -dog_size * 0.15, dog_size * 0.55])
        sphere(d=dog_size * 0.08);
        
        // Nose
        translate([dog_size * 0.95, 0, dog_size * 0.45])
        sphere(d=dog_size * 0.1);
    }
}

// Assembly
module shorkie() {
    dog_body();
    dark_fur();
    light_fur();
    face_details();
}

// Create the shorkie
shorkie();
`}
];