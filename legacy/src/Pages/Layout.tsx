import { Outlet } from "react-router";
import {
    Container,
  } from "semantic-ui-react";
// import { SetStateAction, useState } from "react";
//import { useAuthenticator } from '@aws-amplify/ui-react';

// Examples for layouts https://semantic-ui-forest.com/templates
// Semantic UI React https://react.semantic-ui.com/
// UI Links: https://stackoverflow.com/questions/74573972/implementing-links-in-a-semantic-ui-menu
function Layout() {
    // const [dropdownMenuStyle, setDropdownMenuStyle] = useState<any>(
    //     {
    //         display: "none"
    //     });

    //const { signOut } = useAuthenticator();


    // function handleToggleDropdownMenu() {
    //     if (dropdownMenuStyle.display === "none") {
    //         setDropdownMenuStyle({ display: "flex" });
    //     } else {
    //         setDropdownMenuStyle({ display: "none" });
    //     }
    // };

    // const [activeItem, setActiveItem] = useState("home");
    // const setActiveItemOnClick = (name: SetStateAction<string>) => {
  
    //     setActiveItem(name);
    // };

    return (
      <div>
{/*         <Grid padded className="tablet computer only">
          <Menu borderless fluid fixed="top" size="huge">
            <Container>
              <Menu.Item>
                <Image src="/images/chat3dlogo.png" />&nbsp;<p>Chat3D</p>
              </Menu.Item>
              <Menu.Menu position="right">
                <Menu.Item as={NavLink}
                  to="/chat/new"
                  name="chatnew"
                  >
                    <Popup content="New Chat" trigger={<Icon name="edit"/>}/>
                  </Menu.Item>
              </Menu.Menu>
            </Container>
          </Menu>
        </Grid>
        <Grid padded className="mobile only">
          <Menu borderless fluid fixed="top" size="huge">
            <Menu.Item>
              <Image src="/images/chat3dlogo.png" />&nbsp;<p>Chat3D</p>
            </Menu.Item>
            <Menu.Menu position="right">
              <Menu.Item as={NavLink}
                  to="/chat/new"
                  name="chatnew"
                  >
                  <Popup content="New Chat" trigger={<Icon name="edit"/>}/>
                </Menu.Item>
              <Menu.Item>
                <Button
                  icon
                  basic
                  toggle
                  onClick={handleToggleDropdownMenu}
                >
                  <Icon name="content" />
                </Button>
              </Menu.Item>
            </Menu.Menu>
            <Menu
              vertical
              borderless
              fluid
              style={dropdownMenuStyle}
            >
              <Menu.Item as={NavLink}
                to="/" 
                name="home" 
                active={activeItem === "home"}
                onClick={()=>setActiveItemOnClick("home")}
                >
                Home
              </Menu.Item>
              <Menu.Item as={NavLink}
                to="/chat"
                name="chat"
                active={activeItem === "chat"}
                onClick={()=>setActiveItemOnClick("chat")}
                >
                Chat
              </Menu.Item>
            </Menu>
          </Menu>
        </Grid> */}
        <Container>
            <Outlet />
        </Container>
      </div>
      
    );
}

export default Layout;